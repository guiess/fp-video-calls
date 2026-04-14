use rust_socketio::{
    asynchronous::{Client, ClientBuilder},
    Payload,
};
use serde_json::json;
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Events received from the signaling server.
#[derive(Debug, Clone)]
pub enum SignalEvent {
    Connected,
    Disconnected,
    Registered { code: String },
    PeerJoined { user_id: String },
    PeerLeft { user_id: String },
    Signal { from: String, signal: serde_json::Value },
    Error { message: String },
}

/// Async Socket.IO signaling client.
pub struct SignalingClient {
    server_url: String,
    event_tx: mpsc::UnboundedSender<SignalEvent>,
    client: Option<Client>,
}

impl SignalingClient {
    pub fn new(server_url: String, event_tx: mpsc::UnboundedSender<SignalEvent>) -> Self {
        Self {
            server_url,
            event_tx,
            client: None,
        }
    }

    /// Connect to the signaling server.
    pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let tx = self.event_tx.clone();
        let tx_joined = self.event_tx.clone();
        let tx_left = self.event_tx.clone();
        let tx_signal = self.event_tx.clone();
        let tx_registered = self.event_tx.clone();
        let tx_error = self.event_tx.clone();

        let client = ClientBuilder::new(&self.server_url)
            .on("open", move |_, _| {
                let tx = tx.clone();
                Box::pin(async move {
                    info!("[signaling] connected");
                    let _ = tx.send(SignalEvent::Connected);
                })
            })
            .on("rc_registered", move |payload, _| {
                let tx = tx_registered.clone();
                Box::pin(async move {
                    if let Payload::Text(values) = payload {
                        if let Some(val) = values.first() {
                            if let Some(code) = val.get("code").and_then(|c| c.as_str()) {
                                info!("[signaling] registered with code: {}", code);
                                let _ = tx.send(SignalEvent::Registered {
                                    code: code.to_string(),
                                });
                            }
                        }
                    }
                })
            })
            .on("rc_peer_joined", move |payload, _| {
                let tx = tx_joined.clone();
                Box::pin(async move {
                    if let Payload::Text(values) = payload {
                        if let Some(val) = values.first() {
                            if let Some(uid) = val.get("userId").and_then(|u| u.as_str()) {
                                info!("[signaling] peer joined: {}", uid);
                                let _ = tx.send(SignalEvent::PeerJoined {
                                    user_id: uid.to_string(),
                                });
                            }
                        }
                    }
                })
            })
            .on("rc_peer_left", move |payload, _| {
                let tx = tx_left.clone();
                Box::pin(async move {
                    if let Payload::Text(values) = payload {
                        if let Some(val) = values.first() {
                            if let Some(uid) = val.get("userId").and_then(|u| u.as_str()) {
                                info!("[signaling] peer left: {}", uid);
                                let _ = tx.send(SignalEvent::PeerLeft {
                                    user_id: uid.to_string(),
                                });
                            }
                        }
                    }
                })
            })
            .on("rc_signal", move |payload, _| {
                let tx = tx_signal.clone();
                Box::pin(async move {
                    if let Payload::Text(values) = payload {
                        if let Some(val) = values.first() {
                            let from = val
                                .get("from")
                                .and_then(|f| f.as_str())
                                .unwrap_or("")
                                .to_string();
                            let signal = val.get("signal").cloned().unwrap_or_default();
                            let _ = tx.send(SignalEvent::Signal { from, signal });
                        }
                    }
                })
            })
            .on("rc_error", move |payload, _| {
                let tx = tx_error.clone();
                Box::pin(async move {
                    if let Payload::Text(values) = payload {
                        if let Some(val) = values.first() {
                            let msg = val
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("Unknown error")
                                .to_string();
                            warn!("[signaling] error: {}", msg);
                            let _ = tx.send(SignalEvent::Error { message: msg });
                        }
                    }
                })
            })
            .connect()
            .await?;

        self.client = Some(client);
        Ok(())
    }

    /// Register as a sharer — server will assign a session code.
    pub async fn register(&self, user_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(client) = &self.client {
            client
                .emit("rc_register", json!({ "userId": user_id }))
                .await?;
        }
        Ok(())
    }

    /// Connect as a viewer using a session code.
    pub async fn connect_to_session(
        &self,
        code: &str,
        user_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(client) = &self.client {
            client
                .emit("rc_connect", json!({ "code": code, "userId": user_id }))
                .await?;
        }
        Ok(())
    }

    /// Send WebRTC signaling data (offer/answer/ICE) to the remote peer.
    pub async fn send_signal(
        &self,
        code: &str,
        signal: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(client) = &self.client {
            client
                .emit("rc_signal", json!({ "code": code, "signal": signal }))
                .await?;
        }
        Ok(())
    }

    /// Disconnect from the signaling server.
    pub async fn disconnect(&mut self) {
        if let Some(client) = self.client.take() {
            let _ = client.disconnect().await;
            info!("[signaling] disconnected");
        }
    }
}
