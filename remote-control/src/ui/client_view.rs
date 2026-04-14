use egui::RichText;

/// Connection state for the client (viewer) side.
#[derive(Debug, Clone, PartialEq)]
pub enum ClientState {
    Idle,
    Connecting,
    Connected {
        host_id: String,
        control_active: bool,
        control_requested: bool,
        audio_muted: bool,
    },
    Error(String),
}

/// Actions returned from the client UI.
#[derive(Debug, Clone, PartialEq)]
pub enum ClientAction {
    None,
    Connect,
    Disconnect,
    RequestControl,
    ReleaseControl,
    ToggleAudio,
}

/// Renders the "Connect to Remote" panel. Returns an action if a button was clicked.
pub fn render(
    ui: &mut egui::Ui,
    state: &ClientState,
    code_input: &mut String,
) -> ClientAction {
    let mut action = ClientAction::None;

    ui.vertical_centered(|ui| {
        ui.add_space(20.0);
        ui.label(RichText::new("🔗 Connect to Remote").size(24.0).strong());
        ui.add_space(16.0);

        match state {
            ClientState::Idle => {
                ui.label("Enter the session code from the host:");
                ui.add_space(8.0);

                let response = ui.add(
                    egui::TextEdit::singleline(code_input)
                        .font(egui::TextStyle::Heading)
                        .hint_text("XXX-XXX-XXX")
                        .desired_width(200.0)
                        .horizontal_align(egui::Align::Center),
                );

                ui.add_space(12.0);

                let can_connect = code_input.len() >= 11;
                let connect_clicked = ui
                    .add_enabled(can_connect, egui::Button::new(RichText::new("🔗  Connect").size(16.0)))
                    .clicked();

                let enter_pressed = response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));

                if (connect_clicked || enter_pressed) && can_connect {
                    action = ClientAction::Connect;
                }
            }
            ClientState::Connecting => {
                ui.label("Connecting...");
                ui.spinner();
            }
            ClientState::Connected {
                host_id,
                control_active,
                control_requested,
                audio_muted,
            } => {
                ui.label(
                    RichText::new("✅ Connected to host")
                        .size(16.0)
                        .color(egui::Color32::from_rgb(34, 197, 94)),
                );
                ui.add_space(4.0);
                ui.label(format!("Host: {}", host_id));
                ui.add_space(12.0);

                if *control_active {
                    ui.label(
                        RichText::new("🎮 You have control")
                            .color(egui::Color32::from_rgb(34, 197, 94)),
                    );
                    ui.add_space(8.0);
                    if ui.button("Release Control").clicked() {
                        action = ClientAction::ReleaseControl;
                    }
                } else if *control_requested {
                    ui.label("Control requested — waiting for host approval...");
                    ui.spinner();
                } else if ui.button("🖱️ Request Control").clicked() {
                    action = ClientAction::RequestControl;
                }

                ui.add_space(8.0);
                let audio_label = if *audio_muted { "🔇 Unmute Audio" } else { "🔊 Mute Audio" };
                if ui.button(audio_label).clicked() {
                    action = ClientAction::ToggleAudio;
                }

                ui.add_space(16.0);
                if ui.button(RichText::new("⏹  Disconnect").size(14.0)).clicked() {
                    action = ClientAction::Disconnect;
                }
            }
            ClientState::Error(msg) => {
                ui.label(
                    RichText::new(format!("❌ {}", msg))
                        .color(egui::Color32::from_rgb(239, 68, 68)),
                );
                ui.add_space(12.0);
                if ui.button("Back").clicked() {
                    action = ClientAction::Disconnect;
                }
            }
        }
    });

    action
}
