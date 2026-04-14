mod app;
mod net;
mod protocol;
mod ui;

use app::{App, AppCommand};
use net::signaling::{SignalEvent, SignalingClient};
use tokio::sync::mpsc;
use tracing::info;

fn main() -> eframe::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fp_remote_control=info".into()),
        )
        .init();

    info!("FP Remote Control v{}", env!("CARGO_PKG_VERSION"));

    // Channels between UI thread and async runtime
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<AppCommand>();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<SignalEvent>();

    // Spawn the tokio runtime in a background thread for signaling
    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    std::thread::spawn(move || {
        rt.block_on(async move {
            let mut signaling: Option<SignalingClient> = None;

            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    AppCommand::StartSharing { server_url } => {
                        info!("[async] starting sharing, connecting to {}", server_url);
                        let mut client = SignalingClient::new(server_url, event_tx.clone());
                        match client.connect().await {
                            Ok(()) => {
                                let user_id = uuid::Uuid::new_v4().to_string();
                                if let Err(e) = client.register(&user_id).await {
                                    let _ = event_tx.send(SignalEvent::Error {
                                        message: format!("Register failed: {}", e),
                                    });
                                }
                                signaling = Some(client);
                            }
                            Err(e) => {
                                let _ = event_tx.send(SignalEvent::Error {
                                    message: format!("Connection failed: {}", e),
                                });
                            }
                        }
                    }
                    AppCommand::StopSharing => {
                        if let Some(mut client) = signaling.take() {
                            client.disconnect().await;
                        }
                    }
                    AppCommand::ConnectToSession { server_url, code } => {
                        info!("[async] connecting to session {}", code);
                        let mut client = SignalingClient::new(server_url, event_tx.clone());
                        match client.connect().await {
                            Ok(()) => {
                                let user_id = uuid::Uuid::new_v4().to_string();
                                if let Err(e) = client.connect_to_session(&code, &user_id).await {
                                    let _ = event_tx.send(SignalEvent::Error {
                                        message: format!("Join failed: {}", e),
                                    });
                                }
                                signaling = Some(client);
                            }
                            Err(e) => {
                                let _ = event_tx.send(SignalEvent::Error {
                                    message: format!("Connection failed: {}", e),
                                });
                            }
                        }
                    }
                    AppCommand::Disconnect => {
                        if let Some(mut client) = signaling.take() {
                            client.disconnect().await;
                        }
                    }
                }
            }
        });
    });

    // Launch the egui window
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([600.0, 450.0])
            .with_min_inner_size([400.0, 300.0])
            .with_title("FP Remote Control"),
        ..Default::default()
    };

    eframe::run_native(
        "FP Remote Control",
        native_options,
        Box::new(move |cc| Ok(Box::new(App::new(cc, cmd_tx, event_rx)))),
    )
}

