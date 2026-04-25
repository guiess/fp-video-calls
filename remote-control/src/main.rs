mod app;
mod capture;
mod codec;
pub mod i18n;
mod input;
mod net;
mod protocol;
mod ui;

use app::{App, AppCommand};
use capture::CapturedFrame;
use codec::AudioChunk;
use input::InputInjector;
use net::peer::{PeerEvent, PeerManager};
use net::signaling::{SignalEvent, SignalingClient};
use tokio::sync::mpsc;
use tracing::{info, warn, error};
use webrtc::ice_transport::ice_server::RTCIceServer;

/// Get the user's Downloads directory, or fall back to Desktop or home.
fn dirs_next() -> Option<std::path::PathBuf> {
    // Try Windows known folder
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let downloads = std::path::PathBuf::from(&profile).join("Downloads");
        if downloads.is_dir() { return Some(downloads); }
        let desktop = std::path::PathBuf::from(&profile).join("Desktop");
        if desktop.is_dir() { return Some(desktop); }
        return Some(std::path::PathBuf::from(profile));
    }
    std::env::current_dir().ok()
}

fn main() -> eframe::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "m2_remote_control=info".into()),
        )
        .init();

    info!("M2 Remote Control v{}", env!("CARGO_PKG_VERSION"));

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<AppCommand>();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<SignalEvent>();
    // Second channel: signaling events for the async loop (WebRTC handshake)
    let (sig_event_tx, mut sig_event_rx) = mpsc::unbounded_channel::<SignalEvent>();

    // Channel for screen frames from capture thread → async loop → DataChannel
    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<CapturedFrame>();
    // Channel for audio chunks from capture thread → async loop → DataChannel
    let (audio_tx, mut audio_rx) = mpsc::unbounded_channel::<AudioChunk>();

    // Wrap event_tx so signaling events go to both UI and async loop
    let ui_event_tx = event_tx.clone();
    let async_event_tx = sig_event_tx;

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    std::thread::spawn(move || {
        rt.block_on(async move {
            let mut signaling: Option<SignalingClient> = None;
            let mut peer: Option<PeerManager> = None;
            let mut peer_event_rx: Option<mpsc::UnboundedReceiver<PeerEvent>> = None;
            let mut session_code: Option<String> = None;
            let mut is_host = false;
            let mut capture_stop_tx: Option<tokio::sync::oneshot::Sender<()>> = None;
            let mut audio_stop_tx: Option<tokio::sync::oneshot::Sender<()>> = None;
            let mut input_injector: Option<InputInjector> = None;
            let mut control_granted = false;
            let mut audio_player: Option<codec::AudioPlayer> = None;
            let mut pending_register_user_id: Option<String> = None;
            // File receive state
            let mut pending_file: Option<(String, String, u64)> = None; // (id, name, size)
            let mut file_data_buf: Vec<u8> = Vec::new();
            let mut server_url_saved = String::new();
            let mut reconnect_attempts: u32 = 0;
            const MAX_RECONNECT: u32 = 5;

            // Fetch TURN credentials from the signaling server
            async fn fetch_ice_servers(server_url: &str) -> Vec<RTCIceServer> {
                let mut servers = vec![
                    RTCIceServer {
                        urls: vec!["stun:stun.l.google.com:19302".to_string()],
                        ..Default::default()
                    },
                ];
                let turn_url = format!("{}/api/turn?userId=rc-{}", server_url, uuid::Uuid::new_v4());
                match reqwest::get(&turn_url).await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(arr) = json.get("iceServers").and_then(|v| v.as_array()) {
                                for entry in arr {
                                    let urls: Vec<String> = entry.get("urls")
                                        .and_then(|u| u.as_array())
                                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                                        .or_else(|| entry.get("urls").and_then(|u| u.as_str()).map(|s| vec![s.to_string()]))
                                        .unwrap_or_default();
                                    if urls.is_empty() { continue; }
                                    let username = entry.get("username").and_then(|u| u.as_str()).unwrap_or("").to_string();
                                    let credential = entry.get("credential").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                    servers.push(RTCIceServer {
                                        urls,
                                        username,
                                        credential,
                                        ..Default::default()
                                    });
                                }
                                info!("[turn] fetched {} ICE servers", servers.len());
                            }
                        }
                    }
                    Err(e) => warn!("[turn] fetch failed (using STUN only): {}", e),
                }
                servers
            }

            loop {
                tokio::select! {
                    // Commands from UI
                    cmd = cmd_rx.recv() => {
                        let Some(cmd) = cmd else { break };
                        match cmd {
                            AppCommand::StartSharing { server_url } => {
                                info!("[async] starting sharing, connecting to {}", server_url);
                                is_host = true;
                                server_url_saved = server_url.clone();
                                reconnect_attempts = 0;
                                pending_register_user_id = Some(uuid::Uuid::new_v4().to_string());
                                let mut client = SignalingClient::new(server_url, async_event_tx.clone());
                                match client.connect().await {
                                    Ok(()) => {
                                        signaling = Some(client);
                                        // register() will be called when Connected event arrives
                                    }
                                    Err(e) => {
                                        let _ = ui_event_tx.send(SignalEvent::Error {
                                            message: format!("Connection failed: {}", e),
                                        });
                                    }
                                }
                            }
                            AppCommand::StopSharing => {
                                if let Some(tx) = capture_stop_tx.take() { let _ = tx.send(()); }
                                if let Some(tx) = audio_stop_tx.take() { let _ = tx.send(()); }
                                if let Some(p) = peer.take() {
                                    p.close().await;
                                }
                                peer_event_rx = None;
                                if let Some(mut client) = signaling.take() {
                                    client.disconnect().await;
                                }
                            }
                            AppCommand::ConnectToSession { server_url, code } => {
                                info!("[async] connecting to session {}", code);
                                is_host = false;
                                session_code = Some(code.clone());
                                server_url_saved = server_url.clone();
                                reconnect_attempts = 0;
                                pending_register_user_id = Some(uuid::Uuid::new_v4().to_string());
                                let mut client = SignalingClient::new(server_url, async_event_tx.clone());
                                match client.connect().await {
                                    Ok(()) => {
                                        signaling = Some(client);
                                        // connect_to_session() will be called when Connected event arrives
                                    }
                                    Err(e) => {
                                        let _ = ui_event_tx.send(SignalEvent::Error {
                                            message: format!("Connection failed: {}", e),
                                        });
                                    }
                                }
                            }
                            AppCommand::Disconnect => {
                                if let Some(p) = peer.take() {
                                    p.close().await;
                                }
                                peer_event_rx = None;
                                if let Some(mut client) = signaling.take() {
                                    client.disconnect().await;
                                }
                            }
                            AppCommand::SendControl { message } => {
                                if let Some(ref p) = peer {
                                    if let Err(e) = p.send_control(&message).await {
                                        warn!("[async] send control failed: {}", e);
                                    }
                                }
                            }
                            AppCommand::GrantControl { granted } => {
                                control_granted = granted;
                                if granted {
                                    input_injector = Some(InputInjector::new());
                                    if let Some(ref p) = peer {
                                        let msg = serde_json::json!({"type": "control_grant"}).to_string();
                                        let _ = p.send_control(&msg).await;
                                    }
                                } else {
                                    input_injector = None;
                                    if let Some(ref p) = peer {
                                        let msg = serde_json::json!({"type": "control_deny"}).to_string();
                                        let _ = p.send_control(&msg).await;
                                    }
                                }
                            }
                            AppCommand::SetAudioMuted { muted } => {
                                if let Some(ref mut player) = audio_player {
                                    player.set_muted(muted);
                                    info!("[audio] muted={}", muted);
                                }
                            }
                            AppCommand::SendFile { path } => {
                                if let Some(ref p) = peer {
                                    match std::fs::read(&path) {
                                        Ok(data) => {
                                            let file_name = std::path::Path::new(&path)
                                                .file_name()
                                                .map(|n| n.to_string_lossy().to_string())
                                                .unwrap_or_else(|| "file".to_string());
                                            let file_id = uuid::Uuid::new_v4().to_string();
                                            // Send file metadata via control channel
                                            let meta = serde_json::json!({
                                                "type": "file_offer",
                                                "id": file_id,
                                                "name": file_name,
                                                "size": data.len()
                                            });
                                            let _ = p.send_control(&meta.to_string()).await;
                                            // Send file data in chunks via file channel
                                            let chunk_size = 16384;
                                            for chunk in data.chunks(chunk_size) {
                                                let mut msg = Vec::with_capacity(36 + chunk.len());
                                                msg.extend_from_slice(file_id.as_bytes());
                                                msg.extend_from_slice(chunk);
                                                if let Err(e) = p.send_file_data(&msg).await {
                                                    warn!("[file] send chunk failed: {}", e);
                                                    break;
                                                }
                                            }
                                            info!("[file] sent {} ({} bytes)", file_name, data.len());
                                        }
                                        Err(e) => warn!("[file] read failed: {}", e),
                                    }
                                }
                            }
                        }
                    }

                    // Signaling events — process WebRTC handshake, then forward to UI
                    Some(sig_event) = sig_event_rx.recv() => {
                        match &sig_event {
                            SignalEvent::Connected => {
                                info!("[async] socket connected, performing deferred register/connect");
                                if let (Some(ref client), Some(ref uid)) = (&signaling, &pending_register_user_id) {
                                    if is_host {
                                        if let Err(e) = client.register(uid).await {
                                            let _ = ui_event_tx.send(SignalEvent::Error {
                                                message: format!("Register failed: {}", e),
                                            });
                                        }
                                    } else if let Some(ref code) = session_code {
                                        if let Err(e) = client.connect_to_session(code, uid).await {
                                            let _ = ui_event_tx.send(SignalEvent::Error {
                                                message: format!("Join failed: {}", e),
                                            });
                                        }
                                    }
                                }
                                pending_register_user_id = None;
                                let _ = ui_event_tx.send(sig_event);
                            }
                            SignalEvent::Registered { code } => {
                                session_code = Some(code.clone());
                                let _ = ui_event_tx.send(sig_event);
                            }
                            SignalEvent::PeerJoined { user_id } => {
                                info!("[async] peer joined: {}, creating WebRTC peer", user_id);
                                let ice_servers = fetch_ice_servers(&server_url_saved).await;
                                let (pe_tx, pe_rx) = mpsc::unbounded_channel::<PeerEvent>();
                                match PeerManager::new(ice_servers.clone(), pe_tx, is_host).await {
                                    Ok(mgr) => {
                                        peer_event_rx = Some(pe_rx);
                                        if is_host {
                                            // Host creates offer
                                            match mgr.create_offer().await {
                                                Ok(offer) => {
                                                    info!("[async] created offer, sending via signaling");
                                                    if let Some(ref client) = signaling {
                                                        if let Some(ref code) = session_code {
                                                            let _ = client.send_signal(code, offer).await;
                                                        }
                                                    }
                                                }
                                                Err(e) => error!("[async] create offer failed: {}", e),
                                            }
                                        }
                                        peer = Some(mgr);
                                    }
                                    Err(e) => {
                                        error!("[async] PeerManager creation failed: {}", e);
                                        let _ = ui_event_tx.send(SignalEvent::Error {
                                            message: format!("WebRTC setup failed: {}", e),
                                        });
                                    }
                                }
                                let _ = ui_event_tx.send(sig_event);
                            }
                            SignalEvent::Signal { from, signal } => {
                                // Route to WebRTC peer
                                if let Some(ref p) = peer {
                                    match p.handle_signal(signal.clone()).await {
                                        Ok(Some(response)) => {
                                            // Send answer or ICE back via signaling
                                            if let Some(ref client) = signaling {
                                                if let Some(ref code) = session_code {
                                                    let _ = client.send_signal(code, response).await;
                                                }
                                            }
                                        }
                                        Ok(None) => {} // No response needed (e.g., ICE candidate)
                                        Err(e) => warn!("[async] handle_signal error: {}", e),
                                    }
                                } else {
                                    // No peer yet — might be an offer arriving before PeerJoined
                                    // Create peer as viewer and handle the offer
                                    let sig_type = signal.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                    if sig_type == "offer" && !is_host {
                                        info!("[async] received offer before PeerJoined, creating viewer peer");
                                        let ice_svrs = fetch_ice_servers(&server_url_saved).await;
                                        let (pe_tx, pe_rx) = mpsc::unbounded_channel::<PeerEvent>();
                                        match PeerManager::new(ice_svrs, pe_tx, false).await {
                                            Ok(mgr) => {
                                                peer_event_rx = Some(pe_rx);
                                                match mgr.handle_signal(signal.clone()).await {
                                                    Ok(Some(answer)) => {
                                                        if let Some(ref client) = signaling {
                                                            if let Some(ref code) = session_code {
                                                                let _ = client.send_signal(code, answer).await;
                                                            }
                                                        }
                                                    }
                                                    Ok(None) => {}
                                                    Err(e) => warn!("[async] handle offer error: {}", e),
                                                }
                                                peer = Some(mgr);
                                            }
                                            Err(e) => error!("[async] viewer peer creation failed: {}", e),
                                        }
                                    }
                                }
                            }
                            SignalEvent::PeerLeft { .. } => {
                                if let Some(p) = peer.take() { p.close().await; }
                                peer_event_rx = None;
                                if let Some(tx) = capture_stop_tx.take() { let _ = tx.send(()); }
                                if let Some(tx) = audio_stop_tx.take() { let _ = tx.send(()); }
                                control_granted = false;
                                input_injector = None;
                                let _ = ui_event_tx.send(sig_event);
                            }
                            // Forward everything else to UI
                            _ => {
                                let _ = ui_event_tx.send(sig_event);
                            }
                        }
                    }

                    // Screen frames from capture thread (host only)
                    Some(frame) = frame_rx.recv(), if peer.is_some() && is_host => {
                        // Drain to latest frame — skip stale ones to avoid lag
                        let mut latest = frame;
                        while let Ok(newer) = frame_rx.try_recv() {
                            latest = newer;
                        }
                        if let Some(p) = &peer {
                            // Prepend width/height header to H.264 data
                            let mut payload = Vec::with_capacity(8 + latest.data.len());
                            payload.extend_from_slice(&latest.width.to_le_bytes());
                            payload.extend_from_slice(&latest.height.to_le_bytes());
                            payload.extend_from_slice(&latest.data);

                            // Chunk for DataChannel (SCTP max ~16KB)
                            let chunk_size = 15000;
                            let num_chunks = (payload.len() + chunk_size - 1) / chunk_size;
                            let frame_id: u32 = rand::random();
                            for (i, chunk) in payload.chunks(chunk_size).enumerate() {
                                let mut pkt = Vec::with_capacity(12 + chunk.len());
                                pkt.extend_from_slice(&frame_id.to_le_bytes());
                                pkt.extend_from_slice(&(i as u32).to_le_bytes());
                                pkt.extend_from_slice(&(num_chunks as u32).to_le_bytes());
                                pkt.extend_from_slice(chunk);
                                if let Err(e) = p.send_screen(&pkt).await {
                                    warn!("[capture] send screen chunk failed: {}", e);
                                    break;
                                }
                            }
                        }
                    }

                    // Audio chunks from capture thread (host only)
                    Some(chunk) = audio_rx.recv(), if peer.is_some() && is_host => {
                        if let Some(p) = &peer {
                            if let Err(e) = p.send_audio(&chunk.data).await {
                                warn!("[audio] send failed: {}", e);
                            }
                        }
                    }

                    // WebRTC peer events
                    Some(peer_event) = async {
                        if let Some(rx) = peer_event_rx.as_mut() {
                            rx.recv().await
                        } else {
                            // No receiver yet, pend forever
                            std::future::pending::<Option<PeerEvent>>().await
                        }
                    } => {
                        match peer_event {
                            PeerEvent::LocalSignal { signal } => {
                                // Send signaling data via Socket.IO
                                if let Some(ref client) = signaling {
                                    if let Some(ref code) = session_code {
                                        if let Err(e) = client.send_signal(code, signal).await {
                                            warn!("[async] send signal failed: {}", e);
                                        }
                                    }
                                }
                            }
                            PeerEvent::DataChannelsReady => {
                                info!("[async] DataChannels ready!");
                                if is_host {
                                    // Start screen capture
                                    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
                                    capture_stop_tx = Some(stop_tx);
                                    capture::start_capture_loop(frame_tx.clone(), stop_rx, 15, 0);
                                    // Start audio capture
                                    let (astop_tx, astop_rx) = tokio::sync::oneshot::channel();
                                    audio_stop_tx = Some(astop_tx);
                                    codec::start_audio_capture(audio_tx.clone(), astop_rx);
                                    info!("[async] screen + audio capture started");
                                } else {
                                    // Viewer: start audio player
                                    audio_player = codec::AudioPlayer::new();
                                    if audio_player.is_some() {
                                        info!("[async] audio player started");
                                    }
                                }
                                let _ = ui_event_tx.send(SignalEvent::PeerJoined {
                                    user_id: "connected".to_string(),
                                });
                            }
                            PeerEvent::ControlMessage { data } => {
                                // Try parsing as ControlMessage first
                                if let Ok(msg) = serde_json::from_str::<protocol::ControlMessage>(&data) {
                                    match &msg {
                                        protocol::ControlMessage::ControlRequest if is_host => {
                                            info!("[async] viewer requested control — prompting host");
                                            let _ = ui_event_tx.send(SignalEvent::ControlRequested {
                                                user_id: "viewer".to_string(),
                                            });
                                        }
                                        protocol::ControlMessage::ControlGrant if !is_host => {
                                            info!("[async] control granted by host");
                                            let _ = ui_event_tx.send(SignalEvent::ControlGranted);
                                        }
                                        protocol::ControlMessage::ControlDeny if !is_host => {
                                            info!("[async] control denied by host");
                                            let _ = ui_event_tx.send(SignalEvent::ControlDenied);
                                        }
                                        protocol::ControlMessage::ControlRevoke if is_host => {
                                            control_granted = false;
                                            input_injector = None;
                                        }
                                        _ if is_host && control_granted => {
                                            if let Some(injector) = &mut input_injector {
                                                injector.handle(&msg);
                                            }
                                        }
                                        _ => {}
                                    }
                                } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                                    // Handle file_offer messages
                                    if json.get("type").and_then(|t| t.as_str()) == Some("file_offer") {
                                        let file_id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let file_name = json.get("name").and_then(|v| v.as_str()).unwrap_or("file").to_string();
                                        let file_size = json.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                                        info!("[file] incoming: {} ({} bytes)", file_name, file_size);
                                        pending_file = Some((file_id, file_name, file_size));
                                        file_data_buf.clear();
                                    }
                                }
                            }
                            PeerEvent::ScreenData { data } => {
                                // Viewer receives screen frames — forward to UI
                                let _ = ui_event_tx.send(SignalEvent::ScreenFrame { data });
                            }
                            PeerEvent::FileMessage { data } => {
                                if let Some((ref file_id, ref file_name, file_size)) = pending_file {
                                    // Strip the 36-byte file_id prefix from chunk
                                    let payload = if data.len() > 36 { &data[36..] } else { &data };
                                    file_data_buf.extend_from_slice(payload);

                                    if file_data_buf.len() as u64 >= file_size {
                                        // Save to Downloads folder
                                        let downloads = dirs_next().unwrap_or_else(|| std::path::PathBuf::from("."));
                                        let save_path = downloads.join(file_name);
                                        match std::fs::write(&save_path, &file_data_buf[..file_size as usize]) {
                                            Ok(()) => info!("[file] saved: {}", save_path.display()),
                                            Err(e) => warn!("[file] save failed: {}", e),
                                        }
                                        pending_file = None;
                                        file_data_buf.clear();
                                    }
                                }
                            }
                            PeerEvent::AudioData { data } => {
                                if let Some(ref player) = audio_player {
                                    player.play(&data);
                                }
                            }
                            PeerEvent::ConnectionState { state } => {
                                info!("[async] connection state: {}", state);
                                if state.contains("Failed") || state.contains("Disconnected") {
                                    // Auto-reconnect
                                    if reconnect_attempts < MAX_RECONNECT {
                                        reconnect_attempts += 1;
                                        let delay = std::time::Duration::from_secs(2u64.pow(reconnect_attempts));
                                        warn!("[async] connection lost, reconnecting in {:?} (attempt {}/{})", delay, reconnect_attempts, MAX_RECONNECT);
                                        tokio::time::sleep(delay).await;

                                        // Close old peer
                                        if let Some(p) = peer.take() { p.close().await; }
                                        peer_event_rx = None;
                                        if let Some(tx) = capture_stop_tx.take() { let _ = tx.send(()); }

                                        // Re-create peer
                                        let ice_svrs = fetch_ice_servers(&server_url_saved).await;
                                        let (pe_tx, pe_rx) = mpsc::unbounded_channel::<PeerEvent>();
                                        if let Ok(mgr) = PeerManager::new(ice_svrs, pe_tx, is_host).await {
                                            peer_event_rx = Some(pe_rx);
                                            if is_host {
                                                if let Ok(offer) = mgr.create_offer().await {
                                                    if let Some(ref client) = signaling {
                                                        if let Some(ref code) = session_code {
                                                            let _ = client.send_signal(code, offer).await;
                                                        }
                                                    }
                                                }
                                            }
                                            peer = Some(mgr);
                                        }
                                    } else {
                                        let _ = ui_event_tx.send(SignalEvent::Error {
                                            message: "Connection lost after max retries".to_string(),
                                        });
                                    }
                                } else if state.contains("Connected") {
                                    reconnect_attempts = 0;
                                }
                            }
                        }
                    }
                }
            }
        });
    });

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([600.0, 450.0])
            .with_min_inner_size([400.0, 300.0])
            .with_title("M2 Remote Control"),
        ..Default::default()
    };

    eframe::run_native(
        "M2 Remote Control",
        native_options,
        Box::new(move |cc| Ok(Box::new(App::new(cc, cmd_tx, event_rx)))),
    )
}
