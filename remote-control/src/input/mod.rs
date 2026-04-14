use enigo::{
    Enigo, Settings,
    Coordinate, Direction, Button, Key,
    Mouse, Keyboard,
};
use arboard::Clipboard;
use tracing::{info, warn};

use crate::protocol::{ControlMessage, MouseButton};

/// Injects OS-level mouse and keyboard events using enigo.
pub struct InputInjector {
    enigo: Enigo,
    screen_width: i32,
    screen_height: i32,
}

impl InputInjector {
    pub fn new() -> Self {
        let enigo = Enigo::new(&Settings::default()).expect("Failed to create Enigo");
        let (w, h) = Self::get_screen_size();
        info!("[input] injector ready, screen {}x{}", w, h);
        Self {
            enigo,
            screen_width: w,
            screen_height: h,
        }
    }

    fn get_screen_size() -> (i32, i32) {
        #[cfg(target_os = "windows")]
        unsafe {
            let w = winapi::um::winuser::GetSystemMetrics(winapi::um::winuser::SM_CXSCREEN);
            let h = winapi::um::winuser::GetSystemMetrics(winapi::um::winuser::SM_CYSCREEN);
            if w > 0 && h > 0 {
                return (w, h);
            }
        }
        (1920, 1080)
    }

    fn to_screen_coords(&self, x: f64, y: f64) -> (i32, i32) {
        let px = (x * self.screen_width as f64) as i32;
        let py = (y * self.screen_height as f64) as i32;
        (px.clamp(0, self.screen_width - 1), py.clamp(0, self.screen_height - 1))
    }

    fn to_enigo_button(button: &MouseButton) -> Button {
        match button {
            MouseButton::Left => Button::Left,
            MouseButton::Right => Button::Right,
            MouseButton::Middle => Button::Middle,
        }
    }

    /// Handle a control message by injecting the appropriate OS input.
    pub fn handle(&mut self, msg: &ControlMessage) {
        match msg {
            ControlMessage::MouseMove { x, y } => {
                let (px, py) = self.to_screen_coords(*x, *y);
                let _ = self.enigo.move_mouse(px, py, Coordinate::Abs);
            }
            ControlMessage::MouseDown { x, y, button } => {
                let (px, py) = self.to_screen_coords(*x, *y);
                let _ = self.enigo.move_mouse(px, py, Coordinate::Abs);
                let _ = self.enigo.button(Self::to_enigo_button(button), Direction::Press);
            }
            ControlMessage::MouseUp { x, y, button } => {
                let (px, py) = self.to_screen_coords(*x, *y);
                let _ = self.enigo.move_mouse(px, py, Coordinate::Abs);
                let _ = self.enigo.button(Self::to_enigo_button(button), Direction::Release);
            }
            ControlMessage::Scroll { x, y, dx, dy } => {
                let (px, py) = self.to_screen_coords(*x, *y);
                let _ = self.enigo.move_mouse(px, py, Coordinate::Abs);
                if dy.abs() > 0.0 {
                    let _ = self.enigo.scroll(*dy as i32, enigo::Axis::Vertical);
                }
                if dx.abs() > 0.0 {
                    let _ = self.enigo.scroll(*dx as i32, enigo::Axis::Horizontal);
                }
            }
            ControlMessage::KeyDown { key, modifiers } => {
                if modifiers.ctrl  { let _ = self.enigo.key(Key::Control, Direction::Press); }
                if modifiers.shift { let _ = self.enigo.key(Key::Shift, Direction::Press); }
                if modifiers.alt   { let _ = self.enigo.key(Key::Alt, Direction::Press); }
                if modifiers.meta  { let _ = self.enigo.key(Key::Meta, Direction::Press); }

                if let Some(k) = Self::map_key(key) {
                    let _ = self.enigo.key(k, Direction::Press);
                } else if let Some(ch) = key.chars().next() {
                    if key.len() == 1 {
                        let _ = self.enigo.key(Key::Unicode(ch), Direction::Press);
                    }
                }
            }
            ControlMessage::KeyUp { key } => {
                if let Some(k) = Self::map_key(key) {
                    let _ = self.enigo.key(k, Direction::Release);
                } else if let Some(ch) = key.chars().next() {
                    if key.len() == 1 {
                        let _ = self.enigo.key(Key::Unicode(ch), Direction::Release);
                    }
                }
                // Release modifiers to avoid stuck keys
                let _ = self.enigo.key(Key::Control, Direction::Release);
                let _ = self.enigo.key(Key::Shift, Direction::Release);
                let _ = self.enigo.key(Key::Alt, Direction::Release);
                let _ = self.enigo.key(Key::Meta, Direction::Release);
            }
            ControlMessage::Clipboard { text } => {
                if let Ok(mut clip) = Clipboard::new() {
                    let _ = clip.set_text(text.clone());
                    info!("[input] clipboard set: {} chars", text.len());
                }
            }
            _ => {}
        }
    }

    fn map_key(key: &str) -> Option<Key> {
        match key {
            "Enter" => Some(Key::Return),
            "Backspace" => Some(Key::Backspace),
            "Tab" => Some(Key::Tab),
            "Escape" => Some(Key::Escape),
            "Delete" => Some(Key::Delete),
            "Home" => Some(Key::Home),
            "End" => Some(Key::End),
            "PageUp" => Some(Key::PageUp),
            "PageDown" => Some(Key::PageDown),
            "ArrowUp" => Some(Key::UpArrow),
            "ArrowDown" => Some(Key::DownArrow),
            "ArrowLeft" => Some(Key::LeftArrow),
            "ArrowRight" => Some(Key::RightArrow),
            "Space" | " " => Some(Key::Space),
            "CapsLock" => Some(Key::CapsLock),
            "F1"  => Some(Key::F1),  "F2"  => Some(Key::F2),
            "F3"  => Some(Key::F3),  "F4"  => Some(Key::F4),
            "F5"  => Some(Key::F5),  "F6"  => Some(Key::F6),
            "F7"  => Some(Key::F7),  "F8"  => Some(Key::F8),
            "F9"  => Some(Key::F9),  "F10" => Some(Key::F10),
            "F11" => Some(Key::F11), "F12" => Some(Key::F12),
            _ => None,
        }
    }
}
