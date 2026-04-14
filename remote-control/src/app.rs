use eframe::egui;
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
}

pub struct App {
    mode: Mode,
    host_state: HostState,
    client_state: ClientState,
    code_input: String,
    server_url: String,
    user_id: String,

    // Channel to send commands to the async runtime
    cmd_tx: mpsc::UnboundedSender<AppCommand>,
    // Channel to receive events from the signaling client
    event_rx: mpsc::UnboundedReceiver<SignalEvent>,
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
        }
    }

    /// Process any pending events from the signaling client.
    fn poll_events(&mut self) {
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
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Poll signaling events
        self.poll_events();

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
                    // Back button
                    if matches!(self.host_state, HostState::Idle | HostState::Error(_)) {
                        if ui.button("← Back").clicked() {
                            self.mode = Mode::Home;
                            self.host_state = HostState::Idle;
                        }
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
                                self.host_state = HostState::Connected {
                                    viewer_id: viewer_id.clone(),
                                    control_granted: !control_granted,
                                };
                            }
                        }
                        host_view::HostAction::None => {}
                    }
                }

                Mode::Client => {
                    // Back button
                    if matches!(self.client_state, ClientState::Idle | ClientState::Error(_)) {
                        if ui.button("← Back").clicked() {
                            self.mode = Mode::Home;
                            self.client_state = ClientState::Idle;
                            self.code_input.clear();
                        }
                    }

                    let action = client_view::render(ui, &self.client_state, &mut self.code_input);
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
                        }
                        client_view::ClientAction::RequestControl => {
                            info!("[app] requesting control");
                        }
                        client_view::ClientAction::ReleaseControl => {
                            info!("[app] releasing control");
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
