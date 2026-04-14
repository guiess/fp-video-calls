use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{info, warn};
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

/// Events emitted by the peer connection layer.
#[derive(Debug, Clone)]
pub enum PeerEvent {
    /// WebRTC signaling data to send via Socket.IO
    LocalSignal { signal: serde_json::Value },
    /// Control DataChannel message received
    ControlMessage { data: String },
    /// File DataChannel message received
    FileMessage { data: Vec<u8> },
    /// Screen DataChannel message received
    ScreenData { data: Vec<u8> },
    /// Connection state changed
    ConnectionState { state: String },
    /// DataChannels are ready for use
    DataChannelsReady,
}

/// Manages a WebRTC peer connection with DataChannels.
pub struct PeerManager {
    pc: Arc<RTCPeerConnection>,
    event_tx: mpsc::UnboundedSender<PeerEvent>,
    control_dc: Option<Arc<RTCDataChannel>>,
    screen_dc: Option<Arc<RTCDataChannel>>,
    is_host: bool,
}

impl PeerManager {
    /// Create a new peer connection.
    pub async fn new(
        ice_servers: Vec<RTCIceServer>,
        event_tx: mpsc::UnboundedSender<PeerEvent>,
        is_host: bool,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;

        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .build();

        let config = RTCConfiguration {
            ice_servers,
            ..Default::default()
        };

        let pc = Arc::new(api.new_peer_connection(config).await?);

        // Monitor connection state
        let tx_state = event_tx.clone();
        pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            let tx = tx_state.clone();
            Box::pin(async move {
                let state_str = format!("{:?}", state);
                info!("[webrtc] connection state: {}", state_str);
                let _ = tx.send(PeerEvent::ConnectionState { state: state_str });
            })
        }));

        // ICE candidate gathering
        let tx_ice = event_tx.clone();
        pc.on_ice_candidate(Box::new(move |candidate| {
            let tx = tx_ice.clone();
            Box::pin(async move {
                if let Some(c) = candidate {
                    if let Ok(json) = c.to_json() {
                        let signal = serde_json::json!({
                            "type": "ice_candidate",
                            "candidate": json.candidate,
                            "sdpMid": json.sdp_mid,
                            "sdpMLineIndex": json.sdp_mline_index,
                        });
                        let _ = tx.send(PeerEvent::LocalSignal { signal });
                    }
                }
            })
        }));

        // Handle incoming DataChannels (viewer side receives channels created by host)
        let tx_dc = event_tx.clone();
        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let tx = tx_dc.clone();
            let label = dc.label().to_string();
            info!("[webrtc] incoming data channel: {}", label);

            Box::pin(async move {
                Self::bind_data_channel(&dc, &label, tx).await;
            })
        }));

        let mut mgr = Self {
            pc,
            event_tx,
            control_dc: None,
            screen_dc: None,
            is_host,
        };

        // Host creates DataChannels; viewer receives them via on_data_channel
        if is_host {
            mgr.create_data_channels().await?;
        }

        Ok(mgr)
    }

    /// Create the DataChannels (host side).
    async fn create_data_channels(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let control_dc = self.pc.create_data_channel("control", None).await?;
        info!("[webrtc] created 'control' data channel");

        let screen_dc = self.pc.create_data_channel("screen", None).await?;
        info!("[webrtc] created 'screen' data channel");

        let file_dc = self.pc.create_data_channel("file", None).await?;
        info!("[webrtc] created 'file' data channel");

        // Bind handlers
        Self::bind_data_channel(&control_dc, "control", self.event_tx.clone()).await;
        Self::bind_data_channel(&screen_dc, "screen", self.event_tx.clone()).await;
        Self::bind_data_channel(&file_dc, "file", self.event_tx.clone()).await;

        self.control_dc = Some(control_dc);
        self.screen_dc = Some(screen_dc);
        Ok(())
    }

    /// Bind event handlers to a DataChannel.
    async fn bind_data_channel(
        dc: &Arc<RTCDataChannel>,
        label: &str,
        tx: mpsc::UnboundedSender<PeerEvent>,
    ) {
        let label_open = label.to_string();
        let tx_open = tx.clone();
        dc.on_open(Box::new(move || {
            let label = label_open.clone();
            let tx = tx_open.clone();
            Box::pin(async move {
                info!("[webrtc] data channel '{}' opened", label);
                if label == "control" {
                    let _ = tx.send(PeerEvent::DataChannelsReady);
                }
            })
        }));

        let label_msg = label.to_string();
        let tx_msg = tx.clone();
        dc.on_message(Box::new(move |msg: DataChannelMessage| {
            let label = label_msg.clone();
            let tx = tx_msg.clone();
            Box::pin(async move {
                match label.as_str() {
                    "control" => {
                        if let Ok(text) = String::from_utf8(msg.data.to_vec()) {
                            let _ = tx.send(PeerEvent::ControlMessage { data: text });
                        }
                    }
                    "screen" => {
                        let _ = tx.send(PeerEvent::ScreenData { data: msg.data.to_vec() });
                    }
                    "file" => {
                        let _ = tx.send(PeerEvent::FileMessage { data: msg.data.to_vec() });
                    }
                    _ => {}
                }
            })
        }));
    }

    /// Create an SDP offer (host side).
    pub async fn create_offer(&self) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let offer = self.pc.create_offer(None).await?;
        self.pc.set_local_description(offer.clone()).await?;
        let signal = serde_json::json!({
            "type": "offer",
            "sdp": offer.sdp,
        });
        Ok(signal)
    }

    /// Create an SDP answer (viewer side).
    pub async fn create_answer(&self) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer.clone()).await?;
        let signal = serde_json::json!({
            "type": "answer",
            "sdp": answer.sdp,
        });
        Ok(signal)
    }

    /// Handle an incoming signaling message (offer/answer/ICE).
    pub async fn handle_signal(&self, signal: serde_json::Value) -> Result<Option<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        let sig_type = signal.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match sig_type {
            "offer" => {
                let sdp = signal.get("sdp").and_then(|s| s.as_str()).unwrap_or("");
                let offer = RTCSessionDescription::offer(sdp.to_string())?;
                self.pc.set_remote_description(offer).await?;
                let answer = self.create_answer().await?;
                Ok(Some(answer))
            }
            "answer" => {
                let sdp = signal.get("sdp").and_then(|s| s.as_str()).unwrap_or("");
                let answer = RTCSessionDescription::answer(sdp.to_string())?;
                self.pc.set_remote_description(answer).await?;
                Ok(None)
            }
            "ice_candidate" => {
                let candidate = signal.get("candidate").and_then(|c| c.as_str()).unwrap_or("");
                let sdp_mid = signal.get("sdpMid").and_then(|m| m.as_str()).map(|s| s.to_string());
                let sdp_mline_index = signal.get("sdpMLineIndex").and_then(|i| i.as_u64()).map(|i| i as u16);

                let ice = webrtc::ice_transport::ice_candidate::RTCIceCandidateInit {
                    candidate: candidate.to_string(),
                    sdp_mid,
                    sdp_mline_index,
                    username_fragment: None,
                };
                self.pc.add_ice_candidate(ice).await?;
                Ok(None)
            }
            _ => {
                warn!("[webrtc] unknown signal type: {}", sig_type);
                Ok(None)
            }
        }
    }

    /// Send a text message on the control DataChannel.
    pub async fn send_control(&self, msg: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(dc) = &self.control_dc {
            dc.send_text(msg.to_string()).await?;
        }
        Ok(())
    }

    /// Send binary data on the screen DataChannel.
    pub async fn send_screen(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(dc) = &self.screen_dc {
            dc.send(&bytes::Bytes::copy_from_slice(data)).await?;
        }
        Ok(())
    }

    /// Close the peer connection.
    pub async fn close(&self) {
        if let Err(e) = self.pc.close().await {
            warn!("[webrtc] close error: {}", e);
        }
    }
}
