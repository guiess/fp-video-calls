use eframe::egui;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::i18n::{Lang, T};
use crate::net::signaling::SignalEvent;
use crate::ui::host_view::{self, HostState};
use crate::ui::client_view::{self, ClientState};

/// Top-level app mode.
#[derive(Debug, Clone, PartialEq)]
enum Mode {
    /// Choosing between Share and Connect.
    Home,
    /// Sharing screen (host).
    Host,
    /// Viewing remote screen (client/viewer).
    Client,
}

/// Commands from the UI thread to the async signaling task.
#[derive(Debug)]
pub enum AppCommand {
    StartSharing { server_url: String },
    StopSharing,
    ConnectToSession { server_url: String, code: String },
    Disconnect,
    /// Send a control message via DataChannel
    SendControl { message: String },
    /// Grant or deny control to a requesting viewer
    GrantControl { granted: bool },
    /// Send a file to the remote peer
    SendFile { path: String },
    /// Mute/unmute audio playback
    SetAudioMuted { muted: bool },
}

pub struct App {
    mode: Mode,
    lang: Lang,
    host_state: HostState,
    client_state: ClientState,
    code_input: String,
    server_url: String,
    user_id: String,

    cmd_tx: mpsc::UnboundedSender<AppCommand>,
    event_rx: mpsc::UnboundedReceiver<SignalEvent>,

    // Screen rendering (viewer side)
    screen_texture: Option<egui::TextureHandle>,
    h264_decoder: Option<openh264::decoder::Decoder>,
    // Chunk reassembly for incoming screen frames
    pending_frame_id: u32,
    pending_chunks: Vec<Option<Vec<u8>>>,
    pending_total: usize,
    pending_received: usize,

    // Control state
    control_pending_request: bool, // host: viewer requested control, waiting for approval
}

impl App {
    pub fn new(
        _cc: &eframe::CreationContext<'_>,
        cmd_tx: mpsc::UnboundedSender<AppCommand>,
        event_rx: mpsc::UnboundedReceiver<SignalEvent>,
    ) -> Self {
        Self {
            mode: Mode::Home,
            lang: Lang::default(),
            host_state: HostState::Idle,
            client_state: ClientState::Idle,
            code_input: String::new(),
            server_url: "https://app-voice-video-server.azurewebsites.net".to_string(),
            user_id: uuid::Uuid::new_v4().to_string(),
            cmd_tx,
            event_rx,
            screen_texture: None,
            h264_decoder: None,
            pending_frame_id: 0,
            pending_chunks: Vec::new(),
            pending_total: 0,
            pending_received: 0,
            control_pending_request: false,
        }
    }

    /// Process any pending events from the signaling client.
    fn poll_events(&mut self, ctx: &egui::Context) {
        while let Ok(event) = self.event_rx.try_recv() {
            match event {
                SignalEvent::Connected => {
                    info!("[app] signaling connected");
                }
                SignalEvent::Registered { code } => {
                    self.host_state = HostState::WaitingForViewers { code };
                }
                SignalEvent::PeerJoined { user_id } => {
                    match self.mode {
                        Mode::Host => {
                            self.host_state = HostState::Connected {
                                viewer_id: user_id,
                                control_granted: false,
                            };
                        }
                        Mode::Client => {
                            self.client_state = ClientState::Connected {
                                host_id: user_id,
                                control_active: false,
                                control_requested: false,
                                audio_muted: false,
                            };
                        }
                        _ => {}
                    }
                }
                SignalEvent::PeerLeft { user_id } => {
                    match self.mode {
                        Mode::Host => {
                            self.host_state = HostState::WaitingForViewers {
                                code: self.get_current_code().unwrap_or_default(),
                            };
                        }
                        Mode::Client => {
                            self.client_state = ClientState::Error("Host disconnected".into());
                        }
                        _ => {}
                    }
                }
                SignalEvent::Signal { from, signal } => {
                    // Will be handled in Phase 2 (WebRTC)
                    info!("[app] received signal from {}", from);
                }
                SignalEvent::Error { message } => {
                    match self.mode {
                        Mode::Host => self.host_state = HostState::Error(message),
                        Mode::Client => self.client_state = ClientState::Error(message),
                        _ => {}
                    }
                }
                SignalEvent::Disconnected => {
                    info!("[app] signaling disconnected");
                }
                SignalEvent::ScreenFrame { data } => {
                    self.handle_encoded_frame(ctx, &data);
                }
                SignalEvent::ControlRequested { user_id } => {
                    info!("[app] control requested by {}", user_id);
                    self.control_pending_request = true;
                }
                SignalEvent::ControlGranted => {
                    if let ClientState::Connected { host_id, control_requested, audio_muted, .. } = &self.client_state {
                        self.client_state = ClientState::Connected {
                            host_id: host_id.clone(),
                            control_active: true,
                            control_requested: false,
                            audio_muted: *audio_muted,
                        };
                    }
                }
                SignalEvent::ControlDenied => {
                    if let ClientState::Connected { host_id, audio_muted, .. } = &self.client_state {
                        self.client_state = ClientState::Connected {
                            host_id: host_id.clone(),
                            control_active: false,
                            control_requested: false,
                            audio_muted: *audio_muted,
                        };
                    }
                }
            }
        }
    }

    fn get_current_code(&self) -> Option<String> {
        match &self.host_state {
            HostState::WaitingForViewers { code } => Some(code.clone()),
            HostState::Connected { .. } => None,
            _ => None,
        }
    }

    /// Handle an incoming screen data chunk — reassemble, then H.264 decode.
    fn handle_encoded_frame(&mut self, ctx: &egui::Context, data: &[u8]) {
        if data.len() < 12 { return; }

        let frame_id = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let chunk_idx = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let num_chunks = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
        let chunk_data = &data[12..];

        // New frame — reset assembly
        if frame_id != self.pending_frame_id {
            self.pending_frame_id = frame_id;
            self.pending_chunks = vec![None; num_chunks];
            self.pending_total = num_chunks;
            self.pending_received = 0;
        }

        if chunk_idx < self.pending_total && self.pending_chunks[chunk_idx].is_none() {
            self.pending_chunks[chunk_idx] = Some(chunk_data.to_vec());
            self.pending_received += 1;
        }

        if self.pending_received < self.pending_total { return; }

        // All chunks received — reassemble
        let mut payload = Vec::new();
        for chunk in &self.pending_chunks {
            if let Some(c) = chunk { payload.extend_from_slice(c); }
        }
        self.pending_chunks.clear();
        self.pending_received = 0;

        if payload.len() < 8 { return; }
        let _width = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let _height = u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
        let h264_data = &payload[8..];

        // Lazy-init decoder
        if self.h264_decoder.is_none() {
            match openh264::decoder::Decoder::new() {
                Ok(d) => self.h264_decoder = Some(d),
                Err(e) => {
                    warn!("[app] failed to create H.264 decoder: {}", e);
                    return;
                }
            }
        }

        let decoder = self.h264_decoder.as_mut().unwrap();

        // Decode — feed entire bitstream (may contain SPS+PPS+IDR or just P-slice)
        match decoder.decode(h264_data) {
            Ok(Some(yuv_frame)) => {
                use openh264::formats::YUVSource;
                let (w, h) = yuv_frame.dimensions();
                let mut rgba = vec![0u8; w * h * 4];
                yuv_frame.write_rgba8(&mut rgba);

                let color_image = egui::ColorImage::from_rgba_unmultiplied([w, h], &rgba);
                self.screen_texture = Some(ctx.load_texture(
                    "remote_screen",
                    color_image,
                    egui::TextureOptions::LINEAR,
                ));
            }
            Ok(None) => {}
            Err(e) => {
                warn!("[app] H.264 decode error: {}", e);
            }
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Poll signaling events
        self.poll_events(ctx);

        // Request repaint to keep polling
        ctx.request_repaint();

        egui::CentralPanel::default().show(ctx, |ui| {
            match self.mode {
                Mode::Home => {
                    let l = self.lang;
                    ui.vertical_centered(|ui| {
                        ui.add_space(40.0);
                        ui.label(
                            egui::RichText::new(T::app_title(l))
                                .size(32.0)
                                .strong(),
                        );
                        ui.add_space(8.0);
                        ui.label(T::app_subtitle(l));
                        ui.add_space(32.0);

                        // Language selector
                        ui.horizontal(|ui| {
                            ui.label(T::language(l));
                            for &lang in Lang::ALL {
                                if ui.selectable_label(self.lang == lang, lang.label()).clicked() {
                                    self.lang = lang;
                                }
                            }
                        });
                        ui.add_space(16.0);

                        // Server URL input
                        ui.horizontal(|ui| {
                            ui.label(T::server(l));
                            ui.text_edit_singleline(&mut self.server_url);
                        });
                        ui.add_space(24.0);

                        ui.columns(2, |cols| {
                            cols[0].vertical_centered(|ui| {
                                if ui
                                    .button(egui::RichText::new(T::share_my_screen(l)).size(18.0))
                                    .clicked()
                                {
                                    self.mode = Mode::Host;
                                    self.host_state = HostState::Connecting;
                                    let _ = self.cmd_tx.send(AppCommand::StartSharing {
                                        server_url: self.server_url.clone(),
                                    });
                                }
                                ui.add_space(8.0);
                                ui.label(T::share_description(l));
                            });
                            cols[1].vertical_centered(|ui| {
                                if ui
                                    .button(egui::RichText::new(T::connect_to_remote(l)).size(18.0))
                                    .clicked()
                                {
                                    self.mode = Mode::Client;
                                    self.client_state = ClientState::Idle;
                                }
                                ui.add_space(8.0);
                                ui.label(T::connect_description(l));
                            });
                        });
                    });
                }

                Mode::Host => {
                    let l = self.lang;
                    if matches!(self.host_state, HostState::Idle | HostState::Error(_)) {
                        if ui.button(T::back(l)).clicked() {
                            self.mode = Mode::Home;
                            self.host_state = HostState::Idle;
                        }
                    }

                    // Control approval prompt
                    if self.control_pending_request {
                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new(T::viewer_requests_control(l)).color(egui::Color32::from_rgb(234, 179, 8)).strong());
                            if ui.button(T::allow(l)).clicked() {
                                self.control_pending_request = false;
                                let _ = self.cmd_tx.send(AppCommand::GrantControl { granted: true });
                                if let HostState::Connected { viewer_id, .. } = &self.host_state {
                                    self.host_state = HostState::Connected {
                                        viewer_id: viewer_id.clone(),
                                        control_granted: true,
                                    };
                                }
                            }
                            if ui.button(T::deny(l)).clicked() {
                                self.control_pending_request = false;
                                let _ = self.cmd_tx.send(AppCommand::GrantControl { granted: false });
                            }
                        });
                    }

                    let action = host_view::render(ui, &self.host_state, l);
                    match action {
                        host_view::HostAction::Start => {
                            self.host_state = HostState::Connecting;
                            let _ = self.cmd_tx.send(AppCommand::StartSharing {
                                server_url: self.server_url.clone(),
                            });
                        }
                        host_view::HostAction::Stop => {
                            let _ = self.cmd_tx.send(AppCommand::StopSharing);
                            self.host_state = HostState::Idle;
                            self.mode = Mode::Home;
                        }
                        host_view::HostAction::ToggleControl => {
                            if let HostState::Connected { viewer_id, control_granted } = &self.host_state {
                                let new_granted = !control_granted;
                                self.host_state = HostState::Connected {
                                    viewer_id: viewer_id.clone(),
                                    control_granted: new_granted,
                                };
                                let _ = self.cmd_tx.send(AppCommand::GrantControl { granted: new_granted });
                            }
                        }
                        host_view::HostAction::None => {}
                    }
                }

                Mode::Client => {
                    let l = self.lang;
                    if matches!(self.client_state, ClientState::Idle | ClientState::Error(_)) {
                        if ui.button(T::back(l)).clicked() {
                            self.mode = Mode::Home;
                            self.client_state = ClientState::Idle;
                            self.code_input.clear();
                        }
                    }

                    let action = client_view::render(ui, &self.client_state, &mut self.code_input, l);

                    // Display remote screen + capture input when control is active
                    let is_control_active = matches!(
                        self.client_state,
                        ClientState::Connected { control_active: true, .. }
                    );

                    if matches!(self.client_state, ClientState::Connected { .. }) {
                        if let Some(tex) = &self.screen_texture {
                            ui.add_space(8.0);
                            let available = ui.available_size();
                            let tex_size = tex.size_vec2();
                            let scale = (available.x / tex_size.x).min(available.y / tex_size.y);
                            let display_size = egui::vec2(tex_size.x * scale, tex_size.y * scale);

                            let (rect, response) = ui.allocate_exact_size(display_size, egui::Sense::click_and_drag());
                            ui.painter().image(tex.id(), rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), egui::Color32::WHITE);

                            // Capture input on the screen area when control is active
                            if is_control_active {
                                // Mouse position — works during both hover and drag
                                let pointer_pos = response.interact_pointer_pos().or(response.hover_pos());
                                if let Some(pos) = pointer_pos {
                                    let nx = ((pos.x - rect.min.x) / rect.width()).clamp(0.0, 1.0) as f64;
                                    let ny = ((pos.y - rect.min.y) / rect.height()).clamp(0.0, 1.0) as f64;

                                    // Mouse move
                                    let msg = serde_json::json!({"type": "mouse_move", "x": nx, "y": ny});
                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                }

                                // Mouse button press/release — use raw pointer events
                                // so press and release are sent independently (enables drag)
                                ui.input(|i| {
                                    for event in &i.events {
                                        if let egui::Event::PointerButton { pos, button, pressed, .. } = event {
                                            let btn_str = match button {
                                                egui::PointerButton::Primary => "left",
                                                egui::PointerButton::Secondary => "right",
                                                egui::PointerButton::Middle => "middle",
                                                _ => "",
                                            };
                                            // Press must be inside rect; release is always sent
                                            if !btn_str.is_empty() && (rect.contains(*pos) || !*pressed) {
                                                let nx = ((pos.x - rect.min.x) / rect.width()).clamp(0.0, 1.0) as f64;
                                                let ny = ((pos.y - rect.min.y) / rect.height()).clamp(0.0, 1.0) as f64;
                                                let event_type = if *pressed { "mouse_down" } else { "mouse_up" };
                                                let msg = serde_json::json!({"type": event_type, "x": nx, "y": ny, "button": btn_str});
                                                let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                            }
                                        }
                                    }
                                });

                                // Scroll
                                let scroll = ui.input(|i| i.smooth_scroll_delta);
                                if scroll.y.abs() > 0.1 || scroll.x.abs() > 0.1 {
                                    if let Some(pos) = ui.input(|i| i.pointer.hover_pos()) {
                                        if rect.contains(pos) {
                                            let nx = ((pos.x - rect.min.x) / rect.width()).clamp(0.0, 1.0) as f64;
                                            let ny = ((pos.y - rect.min.y) / rect.height()).clamp(0.0, 1.0) as f64;
                                            let msg = serde_json::json!({"type": "scroll", "x": nx, "y": ny, "dx": scroll.x as f64, "dy": scroll.y as f64});
                                            let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                        }
                                    }
                                }

                                // Keyboard
                                ui.input(|i| {
                                    for event in &i.events {
                                        match event {
                                            egui::Event::Key { key, pressed, modifiers, .. } => {
                                                let key_str = format!("{:?}", key);
                                                if *pressed {
                                                    let msg = serde_json::json!({
                                                        "type": "key_down",
                                                        "key": key_str,
                                                        "modifiers": {
                                                            "ctrl": modifiers.ctrl,
                                                            "shift": modifiers.shift,
                                                            "alt": modifiers.alt,
                                                            "meta": modifiers.mac_cmd || modifiers.command
                                                        }
                                                    });
                                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                                } else {
                                                    let msg = serde_json::json!({"type": "key_up", "key": key_str});
                                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                                }
                                            }
                                            egui::Event::Text(text) => {
                                                for ch in text.chars() {
                                                    let s = ch.to_string();
                                                    let msg = serde_json::json!({"type": "key_down", "key": s, "modifiers": {"ctrl": false, "shift": false, "alt": false, "meta": false}});
                                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                                    let msg = serde_json::json!({"type": "key_up", "key": s});
                                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                });
                            }
                        }
                    }

                    match action {
                        client_view::ClientAction::Connect => {
                            self.client_state = ClientState::Connecting;
                            let _ = self.cmd_tx.send(AppCommand::ConnectToSession {
                                server_url: self.server_url.clone(),
                                code: self.code_input.clone(),
                            });
                        }
                        client_view::ClientAction::Disconnect => {
                            let _ = self.cmd_tx.send(AppCommand::Disconnect);
                            self.client_state = ClientState::Idle;
                            self.code_input.clear();
                            self.screen_texture = None;
                        }
                        client_view::ClientAction::RequestControl => {
                            let msg = serde_json::json!({"type": "control_request"});
                            let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                            if let ClientState::Connected { host_id, audio_muted, .. } = &self.client_state {
                                self.client_state = ClientState::Connected {
                                    host_id: host_id.clone(),
                                    control_active: false,
                                    control_requested: true,
                                    audio_muted: *audio_muted,
                                };
                            }
                        }
                        client_view::ClientAction::ReleaseControl => {
                            let msg = serde_json::json!({"type": "control_revoke"});
                            let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                            if let ClientState::Connected { host_id, audio_muted, .. } = &self.client_state {
                                self.client_state = ClientState::Connected {
                                    host_id: host_id.clone(),
                                    control_active: false,
                                    control_requested: false,
                                    audio_muted: *audio_muted,
                                };
                            }
                        }
                        client_view::ClientAction::ToggleAudio => {
                            if let ClientState::Connected { host_id, control_active, control_requested, audio_muted } = &self.client_state {
                                let new_muted = !audio_muted;
                                self.client_state = ClientState::Connected {
                                    host_id: host_id.clone(),
                                    control_active: *control_active,
                                    control_requested: *control_requested,
                                    audio_muted: new_muted,
                                };
                                let _ = self.cmd_tx.send(AppCommand::SetAudioMuted { muted: new_muted });
                            }
                        }
                        client_view::ClientAction::SendFile => {
                            if let Some(path) = rfd::FileDialog::new().pick_file() {
                                let _ = self.cmd_tx.send(AppCommand::SendFile {
                                    path: path.to_string_lossy().to_string(),
                                });
                            }
                        }
                        client_view::ClientAction::None => {}
                    }
                }
            }
        });
    }
}
