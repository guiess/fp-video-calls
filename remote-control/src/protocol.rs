use serde::{Deserialize, Serialize};

/// Messages sent over the "control" DataChannel (reliable/ordered).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControlMessage {
    // --- Permission flow ---
    #[serde(rename = "control_request")]
    ControlRequest,
    #[serde(rename = "control_grant")]
    ControlGrant,
    #[serde(rename = "control_deny")]
    ControlDeny,
    #[serde(rename = "control_revoke")]
    ControlRevoke,

    // --- Mouse ---
    #[serde(rename = "mouse_move")]
    MouseMove { x: f64, y: f64 },
    #[serde(rename = "mouse_down")]
    MouseDown { x: f64, y: f64, button: MouseButton },
    #[serde(rename = "mouse_up")]
    MouseUp { x: f64, y: f64, button: MouseButton },
    #[serde(rename = "scroll")]
    Scroll { x: f64, y: f64, dx: f64, dy: f64 },

    // --- Keyboard ---
    #[serde(rename = "key_down")]
    KeyDown { key: String, modifiers: Modifiers },
    #[serde(rename = "key_up")]
    KeyUp { key: String },

    // --- Clipboard ---
    #[serde(rename = "clipboard")]
    Clipboard { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Modifiers {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub meta: bool,
}

/// Messages exchanged via Socket.IO signaling for RC sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    /// Sharer registers a new RC session.
    #[serde(rename = "rc_register")]
    Register { user_id: String },
    /// Server responds with a session code.
    #[serde(rename = "rc_registered")]
    Registered { code: String },
    /// Viewer connects using a session code.
    #[serde(rename = "rc_connect")]
    Connect { code: String, user_id: String },
    /// Server notifies sharer that a viewer joined.
    #[serde(rename = "rc_peer_joined")]
    PeerJoined { user_id: String },
    /// Server notifies that a peer left.
    #[serde(rename = "rc_peer_left")]
    PeerLeft { user_id: String },
    /// WebRTC signaling relay (offer/answer/ICE).
    #[serde(rename = "rc_signal")]
    Signal { from: String, signal: serde_json::Value },
    /// Error from server.
    #[serde(rename = "rc_error")]
    Error { message: String },
}

/// File transfer messages sent over the "file" DataChannel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FileMessage {
    /// Sender announces a file.
    #[serde(rename = "file_offer")]
    Offer { id: String, name: String, size: u64 },
    /// Receiver accepts the file.
    #[serde(rename = "file_accept")]
    Accept { id: String },
    /// Receiver rejects the file.
    #[serde(rename = "file_reject")]
    Reject { id: String },
    /// A chunk of file data (binary, sent separately — this is the metadata).
    #[serde(rename = "file_complete")]
    Complete { id: String },
}

/// Generates a human-readable session code like "483-291-776".
pub fn generate_session_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!(
        "{:03}-{:03}-{:03}",
        rng.gen_range(100..999),
        rng.gen_range(100..999),
        rng.gen_range(100..999)
    )
}
