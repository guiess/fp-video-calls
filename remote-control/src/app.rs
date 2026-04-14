use eframe::egui;
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::info;

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
}

struct FrameAssembly {
    chunks: Vec<Option<Vec<u8>>>,
    total: usize,
    received: usize,
    width: u32,
    height: u32,
}

pub struct App {
    mode: Mode,
    host_state: HostState,
    client_state: ClientState,
    code_input: String,
    server_url: String,
    user_id: String,

    cmd_tx: mpsc::UnboundedSender<AppCommand>,
    event_rx: mpsc::UnboundedReceiver<SignalEvent>,

    // Screen rendering (viewer side)
    screen_texture: Option<egui::TextureHandle>,
    frame_buffer: HashMap<u32, FrameAssembly>,

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
            host_state: HostState::Idle,
            client_state: ClientState::Idle,
            code_input: String::new(),
            server_url: "https://fp-video-calls.azurewebsites.net".to_string(),
            user_id: uuid::Uuid::new_v4().to_string(),
            cmd_tx,
            event_rx,
            screen_texture: None,
            frame_buffer: HashMap::new(),
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
                    self.handle_screen_chunk(ctx, &data);
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

    /// Handle an incoming screen data chunk, reassemble into full JPEG frames.
    fn handle_screen_chunk(&mut self, ctx: &egui::Context, data: &[u8]) {
        if data.len() < 12 { return; }

        let frame_id = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let chunk_idx = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let num_chunks = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;

        let (header_size, width, height) = if chunk_idx == 0 && data.len() >= 20 {
            let w = u32::from_le_bytes([data[12], data[13], data[14], data[15]]);
            let h = u32::from_le_bytes([data[16], data[17], data[18], data[19]]);
            (20, w, h)
        } else {
            (12, 0, 0)
        };

        let chunk_data = data[header_size..].to_vec();

        let assembly = self.frame_buffer.entry(frame_id).or_insert_with(|| {
            FrameAssembly {
                chunks: vec![None; num_chunks],
                total: num_chunks,
                received: 0,
                width,
                height,
            }
        });

        if chunk_idx == 0 && width > 0 {
            assembly.width = width;
            assembly.height = height;
        }

        if chunk_idx < assembly.total && assembly.chunks[chunk_idx].is_none() {
            assembly.chunks[chunk_idx] = Some(chunk_data);
            assembly.received += 1;
        }

        // Check if frame is complete
        if assembly.received == assembly.total {
            let mut jpeg_data = Vec::new();
            for chunk in &assembly.chunks {
                if let Some(c) = chunk {
                    jpeg_data.extend_from_slice(c);
                }
            }

            // Decode JPEG and update texture
            if let Ok(img) = image::load_from_memory_with_format(&jpeg_data, image::ImageFormat::Jpeg) {
                let rgba = img.to_rgba8();
                let size = [rgba.width() as usize, rgba.height() as usize];
                let pixels = rgba.as_flat_samples();
                let color_image = egui::ColorImage::from_rgba_unmultiplied(size, pixels.as_slice());

                self.screen_texture = Some(ctx.load_texture(
                    "remote_screen",
                    color_image,
                    egui::TextureOptions::LINEAR,
                ));
            }

            // Clean up old frame buffers
            self.frame_buffer.retain(|id, _| *id == frame_id);
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
                    ui.vertical_centered(|ui| {
                        ui.add_space(40.0);
                        ui.label(
                            egui::RichText::new("FP Remote Control")
                                .size(32.0)
                                .strong(),
                        );
                        ui.add_space(8.0);
                        ui.label("Remote desktop control for fp-video-calls");
                        ui.add_space(32.0);

                        // Server URL input
                        ui.horizontal(|ui| {
                            ui.label("Server:");
                            ui.text_edit_singleline(&mut self.server_url);
                        });
                        ui.add_space(24.0);

                        ui.columns(2, |cols| {
                            cols[0].vertical_centered(|ui| {
                                if ui
                                    .button(egui::RichText::new("🖥️  Share My Screen").size(18.0))
                                    .clicked()
                                {
                                    self.mode = Mode::Host;
                                    self.host_state = HostState::Connecting;
                                    let _ = self.cmd_tx.send(AppCommand::StartSharing {
                                        server_url: self.server_url.clone(),
                                    });
                                }
                                ui.add_space(8.0);
                                ui.label("Let others view and control your screen");
                            });
                            cols[1].vertical_centered(|ui| {
                                if ui
                                    .button(egui::RichText::new("🔗  Connect to Remote").size(18.0))
                                    .clicked()
                                {
                                    self.mode = Mode::Client;
                                    self.client_state = ClientState::Idle;
                                }
                                ui.add_space(8.0);
                                ui.label("View and control a remote screen");
                            });
                        });
                    });
                }

                Mode::Host => {
                    if matches!(self.host_state, HostState::Idle | HostState::Error(_)) {
                        if ui.button("← Back").clicked() {
                            self.mode = Mode::Home;
                            self.host_state = HostState::Idle;
                        }
                    }

                    // Control approval prompt
                    if self.control_pending_request {
                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("🔔 Viewer requests control!").color(egui::Color32::from_rgb(234, 179, 8)).strong());
                            if ui.button("✅ Allow").clicked() {
                                self.control_pending_request = false;
                                let _ = self.cmd_tx.send(AppCommand::GrantControl { granted: true });
                                if let HostState::Connected { viewer_id, .. } = &self.host_state {
                                    self.host_state = HostState::Connected {
                                        viewer_id: viewer_id.clone(),
                                        control_granted: true,
                                    };
                                }
                            }
                            if ui.button("❌ Deny").clicked() {
                                self.control_pending_request = false;
                                let _ = self.cmd_tx.send(AppCommand::GrantControl { granted: false });
                            }
                        });
                    }

                    let action = host_view::render(ui, &self.host_state);
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
                    if matches!(self.client_state, ClientState::Idle | ClientState::Error(_)) {
                        if ui.button("← Back").clicked() {
                            self.mode = Mode::Home;
                            self.client_state = ClientState::Idle;
                            self.code_input.clear();
                        }
                    }

                    let action = client_view::render(ui, &self.client_state, &mut self.code_input);

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
                            let scale = (available.x / tex_size.x).min(available.y / tex_size.y).min(1.0);
                            let display_size = egui::vec2(tex_size.x * scale, tex_size.y * scale);

                            let (rect, response) = ui.allocate_exact_size(display_size, egui::Sense::click_and_drag());
                            ui.painter().image(tex.id(), rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), egui::Color32::WHITE);

                            // Capture input on the screen area when control is active
                            if is_control_active {
                                if let Some(pos) = response.hover_pos() {
                                    let nx = ((pos.x - rect.min.x) / rect.width()).clamp(0.0, 1.0) as f64;
                                    let ny = ((pos.y - rect.min.y) / rect.height()).clamp(0.0, 1.0) as f64;

                                    // Mouse move
                                    let msg = serde_json::json!({"type": "mouse_move", "x": nx, "y": ny});
                                    let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });

                                    // Mouse clicks
                                    if response.clicked() {
                                        let msg = serde_json::json!({"type": "mouse_down", "x": nx, "y": ny, "button": "left"});
                                        let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                        let msg = serde_json::json!({"type": "mouse_up", "x": nx, "y": ny, "button": "left"});
                                        let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                    }
                                    if response.secondary_clicked() {
                                        let msg = serde_json::json!({"type": "mouse_down", "x": nx, "y": ny, "button": "right"});
                                        let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                        let msg = serde_json::json!({"type": "mouse_up", "x": nx, "y": ny, "button": "right"});
                                        let _ = self.cmd_tx.send(AppCommand::SendControl { message: msg.to_string() });
                                    }
                                }

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
                                self.client_state = ClientState::Connected {
                                    host_id: host_id.clone(),
                                    control_active: *control_active,
                                    control_requested: *control_requested,
                                    audio_muted: !audio_muted,
                                };
                            }
                        }
                        client_view::ClientAction::None => {}
                    }
                }
            }
        });
    }
}
