// Library-only error subset adapted from TinyOCR. No HTTP conversion or logs.
#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("invalid image: {0}")]
    InvalidImage(String),
    #[error("image must be exactly {expected_w}x{expected_h}, got {got_w}x{got_h}")]
    InvalidDimensions {
        expected_w: u32,
        expected_h: u32,
        got_w: u32,
        got_h: u32,
    },
    #[error("image too large")]
    PayloadTooLarge,
    #[error("local inference unavailable: {0}")]
    Backend(String),
}
