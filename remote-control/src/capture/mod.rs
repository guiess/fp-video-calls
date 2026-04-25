use openh264::encoder::Encoder;
use scrap::{Capturer, Display};
use std::io::ErrorKind;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// A captured frame encoded as H.264 bitstream.
pub struct CapturedFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Info about an available display.
#[derive(Debug, Clone)]
pub struct DisplayInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
}

/// List available displays/monitors.
pub fn list_displays() -> Vec<DisplayInfo> {
    Display::all()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, d)| DisplayInfo {
            index: i,
            width: d.width() as u32,
            height: d.height() as u32,
        })
        .collect()
}

/// Runs the screen capture loop in a blocking thread.
/// Captures screen, encodes to H.264, and sends encoded frames.
pub fn start_capture_loop(
    frame_tx: mpsc::UnboundedSender<CapturedFrame>,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
    target_fps: u32,
    display_index: usize,
) {
    std::thread::spawn(move || {
        let displays = Display::all().unwrap_or_default();
        let display = if display_index < displays.len() {
            displays.into_iter().nth(display_index).unwrap()
        } else {
            match Display::primary() {
                Ok(d) => d,
                Err(e) => {
                    warn!("[capture] failed to get display: {}", e);
                    return;
                }
            }
        };

        let width = display.width() as u32;
        let height = display.height() as u32;
        // H.264 requires even dimensions
        let enc_w = (width & !1) as usize;
        let enc_h = (height & !1) as usize;
        info!("[capture] display {}x{}, encoding {}x{}", width, height, enc_w, enc_h);

        let mut capturer = match Capturer::new(display) {
            Ok(c) => c,
            Err(e) => {
                warn!("[capture] failed to create capturer: {}", e);
                return;
            }
        };

        // Create H.264 encoder (auto-downloads OpenH264 on first use)
        let mut encoder = match Encoder::new() {
            Ok(e) => e,
            Err(e) => {
                warn!("[capture] failed to create H.264 encoder: {}", e);
                return;
            }
        };

        let frame_interval = Duration::from_millis(1000 / target_fps as u64);
        let mut error_count: u32 = 0;

        loop {
            if stop_rx.try_recv().is_ok() {
                info!("[capture] stopped");
                return;
            }

            let start = Instant::now();

            match capturer.frame() {
                Ok(frame) => {
                    error_count = 0;
                    let yuv = bgra_to_yuv_buffer(&frame, width as usize, height as usize, enc_w, enc_h);

                    match encoder.encode(&yuv) {
                        Ok(bitstream) => {
                            let encoded = bitstream.to_vec();
                            if !encoded.is_empty() {
                                if frame_tx.send(CapturedFrame {
                                    data: encoded,
                                    width: enc_w as u32,
                                    height: enc_h as u32,
                                }).is_err() {
                                    return;
                                }
                            }
                        }
                        Err(e) => {
                            warn!("[capture] H.264 encode error: {}", e);
                        }
                    }
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                Err(e) => {
                    error_count += 1;
                    if error_count > 5 {
                        // DXGI duplication lost — recreate capturer
                        warn!("[capture] recreating capturer after {} errors: {}", error_count, e);
                        std::thread::sleep(Duration::from_millis(500));
                        let displays = Display::all().unwrap_or_default();
                        let disp = if display_index < displays.len() {
                            displays.into_iter().nth(display_index)
                        } else {
                            Display::primary().ok()
                        };
                        match disp {
                            Some(d) => match Capturer::new(d) {
                                Ok(c) => {
                                    capturer = c;
                                    error_count = 0;
                                    info!("[capture] capturer recreated successfully");
                                }
                                Err(e2) => warn!("[capture] recreate failed: {}", e2),
                            },
                            None => warn!("[capture] no display available"),
                        }
                    } else {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }

            let elapsed = start.elapsed();
            if elapsed < frame_interval {
                std::thread::sleep(frame_interval - elapsed);
            }
        }
    });
}

/// Convert BGRA pixel data (with possible stride padding) to a packed I420 YUVBuffer.
fn bgra_to_yuv_buffer(bgra: &[u8], src_w: usize, src_h: usize, dst_w: usize, dst_h: usize) -> openh264::formats::YUVBuffer {
    let stride = bgra.len() / src_h;
    let y_size = dst_w * dst_h;
    let uv_size = (dst_w / 2) * (dst_h / 2);
    let mut yuv = vec![0u8; y_size + uv_size * 2];

    let (y_plane, uv_planes) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    for row in 0..dst_h {
        for col in 0..dst_w {
            let px = row * stride + col * 4;
            let b = bgra[px] as f32;
            let g = bgra[px + 1] as f32;
            let r = bgra[px + 2] as f32;

            y_plane[row * dst_w + col] = (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 255.0) as u8;

            if row % 2 == 0 && col % 2 == 0 {
                let uv_idx = (row / 2) * (dst_w / 2) + (col / 2);
                u_plane[uv_idx] = (-0.169 * r - 0.331 * g + 0.500 * b + 128.0).clamp(0.0, 255.0) as u8;
                v_plane[uv_idx] = (0.500 * r - 0.419 * g - 0.081 * b + 128.0).clamp(0.0, 255.0) as u8;
            }
        }
    }

    openh264::formats::YUVBuffer::from_vec(yuv, dst_w, dst_h)
}
