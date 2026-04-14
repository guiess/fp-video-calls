use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Encoded audio chunk ready for DataChannel transport.
pub struct AudioChunk {
    pub data: Vec<u8>,
}

/// Linear PCM f32 sample → μ-law compressed byte (ITU G.711).
fn f32_to_ulaw(sample: f32) -> u8 {
    let s = (sample * 32768.0).clamp(-32768.0, 32767.0) as i16;
    let sign = if s < 0 { 0x80u8 } else { 0u8 };
    let mut magnitude = if s < 0 { -(s as i32) } else { s as i32 };
    magnitude = magnitude.min(0x1FFF);
    magnitude += 0x84;
    let exponent = ((magnitude as u32).leading_zeros() as i32 - 17).clamp(0, 7);
    let exp = 7 - exponent as u8;
    let mantissa = ((magnitude >> (exp + 3)) & 0x0F) as u8;
    !(sign | (exp << 4) | mantissa)
}

/// Captures system audio (loopback) using WASAPI, encodes as μ-law.
pub fn start_audio_capture(
    audio_tx: mpsc::UnboundedSender<AudioChunk>,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
) {
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = host.default_output_device()
            .or_else(|| host.default_input_device());

        let device = match device {
            Some(d) => d,
            None => { warn!("[audio] no audio device"); return; }
        };

        info!("[audio] device: {}", device.name().unwrap_or_else(|_| "?".into()));

        let config = match device.default_output_config()
            .or_else(|_| device.default_input_config()) {
            Ok(c) => c,
            Err(e) => { warn!("[audio] no config: {}", e); return; }
        };

        let channels = config.channels() as usize;
        info!("[audio] {}Hz, {} ch", config.sample_rate().0, channels);

        // Accumulate ~20ms worth of samples before sending
        let frame_size = config.sample_rate().0 as usize / 50;
        let mut buffer: Vec<u8> = Vec::with_capacity(frame_size);
        let tx = audio_tx.clone();

        let stream = device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                for chunk in data.chunks(channels) {
                    let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                    buffer.push(f32_to_ulaw(mono));

                    if buffer.len() >= frame_size {
                        let _ = tx.send(AudioChunk { data: buffer.clone() });
                        buffer.clear();
                    }
                }
            },
            |err| warn!("[audio] error: {}", err),
            None,
        );

        let stream = match stream {
            Ok(s) => s,
            Err(e) => { warn!("[audio] stream failed: {}", e); return; }
        };

        let _ = stream.play();
        info!("[audio] capture started");

        loop {
            if stop_rx.try_recv().is_ok() {
                info!("[audio] stopped");
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

/// μ-law byte → f32 PCM sample.
fn ulaw_to_f32(byte: u8) -> f32 {
    let val = !byte;
    let sign = if val & 0x80 != 0 { -1.0f32 } else { 1.0 };
    let exponent = ((val >> 4) & 0x07) as i32;
    let mantissa = (val & 0x0F) as i32;
    let magnitude = ((mantissa << (exponent + 3)) + (1 << (exponent + 3)) - 0x84) as f32;
    sign * magnitude / 32768.0
}

/// Audio player — receives μ-law chunks and plays them via the default output device.
pub struct AudioPlayer {
    sample_tx: std::sync::mpsc::Sender<f32>,
    _stream: cpal::Stream,
    muted: bool,
}

impl AudioPlayer {
    pub fn new() -> Option<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device()?;
        let config = device.default_output_config().ok()?;
        let channels = config.channels() as usize;

        info!("[audio-play] output: {} ({}Hz, {} ch)",
            device.name().unwrap_or_else(|_| "?".into()),
            config.sample_rate().0, channels);

        let (tx, rx) = std::sync::mpsc::channel::<f32>();
        let rx = std::sync::Arc::new(std::sync::Mutex::new(rx));

        let rx_clone = rx.clone();
        let stream = device.build_output_stream(
            &config.into(),
            move |output: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let rx = rx_clone.lock().unwrap();
                for frame in output.chunks_mut(channels) {
                    let sample = rx.try_recv().unwrap_or(0.0);
                    for s in frame.iter_mut() {
                        *s = sample;
                    }
                }
            },
            |err| warn!("[audio-play] error: {}", err),
            None,
        ).ok()?;

        stream.play().ok()?;
        info!("[audio-play] started");

        Some(Self {
            sample_tx: tx,
            _stream: stream,
            muted: false,
        })
    }

    /// Feed μ-law encoded audio data for playback.
    pub fn play(&self, ulaw_data: &[u8]) {
        if self.muted { return; }
        for &byte in ulaw_data {
            let _ = self.sample_tx.send(ulaw_to_f32(byte));
        }
    }

    pub fn set_muted(&mut self, muted: bool) {
        self.muted = muted;
    }
}
