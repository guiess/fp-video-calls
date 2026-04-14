use egui::RichText;

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
pub fn render(ui: &mut egui::Ui, state: &HostState) -> HostAction {
    let mut action = HostAction::None;

    ui.vertical_centered(|ui| {
        ui.add_space(20.0);
        ui.label(RichText::new("🖥️ Share My Screen").size(24.0).strong());
        ui.add_space(16.0);

        match state {
            HostState::Idle => {
                ui.label("Start sharing to get a session code that others can use to connect.");
                ui.add_space(12.0);
                if ui.button(RichText::new("▶  Start Sharing").size(16.0)).clicked() {
                    action = HostAction::Start;
                }
            }
            HostState::Connecting => {
                ui.label("Connecting to server...");
                ui.spinner();
            }
            HostState::WaitingForViewers { code } => {
                ui.label("Share this code with the viewer:");
                ui.add_space(8.0);
                ui.label(RichText::new(code).size(36.0).strong().monospace());
                ui.add_space(8.0);
                if ui.button("📋 Copy Code").clicked() {
                    ui.ctx().copy_text(code.clone());
                }
                ui.add_space(16.0);
                ui.label("Waiting for viewer to connect...");
                ui.spinner();
                ui.add_space(16.0);
                if ui.button(RichText::new("⏹  Stop Sharing").size(14.0)).clicked() {
                    action = HostAction::Stop;
                }
            }
            HostState::Connected { viewer_id, control_granted } => {
                ui.label(
                    RichText::new("✅ Viewer connected")
                        .size(16.0)
                        .color(egui::Color32::from_rgb(34, 197, 94)),
                );
                ui.add_space(4.0);
                ui.label(format!("Viewer: {}", viewer_id));
                ui.add_space(12.0);
                if *control_granted {
                    ui.label(
                        RichText::new("⚠ Remote control is ACTIVE")
                            .color(egui::Color32::from_rgb(234, 179, 8)),
                    );
                    ui.add_space(8.0);
                    if ui.button("🔒 Revoke Control").clicked() {
                        action = HostAction::ToggleControl;
                    }
                } else {
                    ui.label("Remote control is disabled.");
                }
                ui.add_space(16.0);
                if ui.button(RichText::new("⏹  Stop Sharing").size(14.0)).clicked() {
                    action = HostAction::Stop;
                }
            }
            HostState::Error(msg) => {
                ui.label(
                    RichText::new(format!("❌ {}", msg))
                        .color(egui::Color32::from_rgb(239, 68, 68)),
                );
                ui.add_space(12.0);
                if ui.button("Retry").clicked() {
                    action = HostAction::Start;
                }
            }
        }
    });

    action
}
