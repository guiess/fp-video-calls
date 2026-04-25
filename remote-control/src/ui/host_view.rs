use egui::RichText;
use crate::i18n::{Lang, T};

/// Connection state for the host (sharer) side.
#[derive(Debug, Clone, PartialEq)]
pub enum HostState {
    Idle,
    Connecting,
    WaitingForViewers { code: String },
    Connected { viewer_id: String, control_granted: bool },
    Error(String),
}

/// Actions returned from the host UI.
#[derive(Debug, Clone, PartialEq)]
pub enum HostAction {
    None,
    Start,
    Stop,
    ToggleControl,
}

/// Renders the "Share My Screen" panel. Returns an action if a button was clicked.
pub fn render(ui: &mut egui::Ui, state: &HostState, l: Lang) -> HostAction {
    let mut action = HostAction::None;

    ui.vertical_centered(|ui| {
        ui.add_space(20.0);
        ui.label(RichText::new(T::host_title(l)).size(24.0).strong());
        ui.add_space(16.0);

        match state {
            HostState::Idle => {
                ui.label(T::host_idle(l));
                ui.add_space(12.0);
                if ui.button(RichText::new(T::start_sharing(l)).size(16.0)).clicked() {
                    action = HostAction::Start;
                }
            }
            HostState::Connecting => {
                ui.label(T::connecting_to_server(l));
                ui.spinner();
            }
            HostState::WaitingForViewers { code } => {
                ui.label(T::share_code_prompt(l));
                ui.add_space(8.0);
                ui.label(RichText::new(code).size(36.0).strong().monospace());
                ui.add_space(8.0);
                if ui.button(T::copy_code(l)).clicked() {
                    ui.ctx().copy_text(code.clone());
                }
                ui.add_space(16.0);
                ui.label(T::waiting_for_viewer(l));
                ui.spinner();
                ui.add_space(16.0);
                if ui.button(RichText::new(T::stop_sharing(l)).size(14.0)).clicked() {
                    action = HostAction::Stop;
                }
            }
            HostState::Connected { viewer_id, control_granted } => {
                ui.label(
                    RichText::new(T::viewer_connected(l))
                        .size(16.0)
                        .color(egui::Color32::from_rgb(34, 197, 94)),
                );
                ui.add_space(4.0);
                ui.label(format!("Viewer: {}", viewer_id));
                ui.add_space(12.0);
                if *control_granted {
                    ui.label(
                        RichText::new(T::control_active_warning(l))
                            .color(egui::Color32::from_rgb(234, 179, 8)),
                    );
                    ui.add_space(8.0);
                    if ui.button(T::revoke_control(l)).clicked() {
                        action = HostAction::ToggleControl;
                    }
                } else {
                    ui.label(T::control_disabled(l));
                }
                ui.add_space(16.0);
                if ui.button(RichText::new(T::stop_sharing(l)).size(14.0)).clicked() {
                    action = HostAction::Stop;
                }
            }
            HostState::Error(msg) => {
                ui.label(
                    RichText::new(format!("❌ {}", msg))
                        .color(egui::Color32::from_rgb(239, 68, 68)),
                );
                ui.add_space(12.0);
                if ui.button(T::retry(l)).clicked() {
                    action = HostAction::Start;
                }
            }
        }
    });

    action
}
