use egui::RichText;
use crate::i18n::{Lang, T};

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
    SendFile,
}

/// Renders the client panel. Returns an action if a button was clicked.
pub fn render(
    ui: &mut egui::Ui,
    state: &ClientState,
    code_input: &mut String,
    l: Lang,
) -> ClientAction {
    let mut action = ClientAction::None;

    // When connected, show only a compact toolbar
    if matches!(state, ClientState::Connected { .. }) {
        match state {
            ClientState::Connected {
                host_id: _,
                control_active,
                control_requested,
                audio_muted,
            } => {
                ui.horizontal_wrapped(|ui| {
                    ui.label(
                        RichText::new(T::connected(l))
                            .color(egui::Color32::from_rgb(34, 197, 94)),
                    );
                    ui.separator();

                    if *control_active {
                        ui.label(
                            RichText::new(T::controlling(l))
                                .color(egui::Color32::from_rgb(34, 197, 94)),
                        );
                        if ui.button(T::release(l)).clicked() {
                            action = ClientAction::ReleaseControl;
                        }
                    } else if *control_requested {
                        ui.spinner();
                        ui.label(T::requesting(l));
                    } else if ui.button(T::request_control(l)).clicked() {
                        action = ClientAction::RequestControl;
                    }

                    ui.separator();
                    let audio_label = if *audio_muted { "🔇" } else { "🔊" };
                    if ui.button(audio_label).clicked() {
                        action = ClientAction::ToggleAudio;
                    }
                    if ui.button("📁").clicked() {
                        action = ClientAction::SendFile;
                    }
                    if ui.button(T::disconnect(l)).clicked() {
                        action = ClientAction::Disconnect;
                    }
                });
            }
            _ => unreachable!(),
        }
        return action;
    }

    ui.vertical_centered(|ui| {
        ui.add_space(20.0);
        ui.label(RichText::new(T::client_title(l)).size(24.0).strong());
        ui.add_space(16.0);

        match state {
            ClientState::Idle => {
                ui.label(T::enter_code(l));
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
                    .add_enabled(can_connect, egui::Button::new(RichText::new(T::connect(l)).size(16.0)))
                    .clicked();

                let enter_pressed = response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));

                if (connect_clicked || enter_pressed) && can_connect {
                    action = ClientAction::Connect;
                }
            }
            ClientState::Connecting => {
                ui.label(T::connecting(l));
                ui.spinner();
            }
            ClientState::Connected { .. } => {}
            ClientState::Error(msg) => {
                ui.label(
                    RichText::new(format!("❌ {}", msg))
                        .color(egui::Color32::from_rgb(239, 68, 68)),
                );
                ui.add_space(12.0);
                if ui.button(T::back(l)).clicked() {
                    action = ClientAction::Disconnect;
                }
            }
        }
    });

    action
}