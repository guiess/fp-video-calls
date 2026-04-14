use scrap::{Capturer, Display};
use std::io::ErrorKind;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// A captured frame as JPEG bytes.
pub struct CapturedFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Runs the screen capture loop in a blocking thread.
/// Sends JPEG-encoded frames to the channel at the target FPS.
pub fn start_capture_loop(
    frame_tx: mpsc::UnboundedSender<CapturedFrame>,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
    target_fps: u32,
) {
    std::thread::spawn(move || {
        let display = match Display::primary() {
            Ok(d) => d,
            Err(e) => {
                warn!("[capture] failed to get primary display: {}", e);
                return;
            }
        };

        let width = display.width() as u32;
        let height = display.height() as u32;
        info!("[capture] display {}x{}", width, height);

        let mut capturer = match Capturer::new(display) {
            Ok(c) => c,
            Err(e) => {
                warn!("[capture] failed to create capturer: {}", e);
                return;
            }
        };

        let frame_interval = Duration::from_millis(1000 / target_fps as u64);

        loop {
            // Check stop signal
            if stop_rx.try_recv().is_ok() {
                info!("[capture] stopped");
                return;
            }

            let start = Instant::now();

            match capturer.frame() {
                Ok(frame) => {
                    // frame is BGRA, convert to JPEG
                    if let Some(jpeg) = encode_bgra_to_jpeg(&frame, width, height, 40) {
                        if frame_tx.send(CapturedFrame { data: jpeg, width, height }).is_err() {
                            return; // receiver dropped
                        }
                    }
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    // No new frame yet, skip
                }
                Err(e) => {
                    warn!("[capture] frame error: {}", e);
                    std::thread::sleep(Duration::from_millis(100));
                }
            }

            let elapsed = start.elapsed();
            if elapsed < frame_interval {
                std::thread::sleep(frame_interval - elapsed);
            }
        }
    });
}

/// Encode BGRA pixel data to JPEG bytes.
fn encode_bgra_to_jpeg(bgra: &[u8], width: u32, height: u32, quality: u8) -> Option<Vec<u8>> {
    use image::{ImageBuffer, RgbImage};
    use std::io::Cursor;

    // BGRA → RGB
    let expected_len = (width * height * 4) as usize;
    if bgra.len() < expected_len {
        return None;
    }

    let mut rgb_buf: Vec<u8> = Vec::with_capacity((width * height * 3) as usize);
    // scrap may have stride padding, handle row by row
    let stride = bgra.len() / height as usize;
    for y in 0..height as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let px = row_start + x * 4;
            rgb_buf.push(bgra[px + 2]); // R
            rgb_buf.push(bgra[px + 1]); // G
            rgb_buf.push(bgra[px]);     // B
        }
    }

    let img: RgbImage = ImageBuffer::from_raw(width, height, rgb_buf)?;
    let mut jpeg_bytes = Cursor::new(Vec::new());
    img.write_to(&mut jpeg_bytes, image::ImageFormat::Jpeg).ok()?;
    Some(jpeg_bytes.into_inner())
}
