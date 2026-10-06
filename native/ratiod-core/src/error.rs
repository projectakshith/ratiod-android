use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NetworkError,
    Timeout,
    TlsError,
    InvalidCredentials,
    CaptchaRequired,
    CaptchaRejected,
    AccountLocked,
    SessionExpired,
    SessionConflict,
    UnexpectedResponse,
    ParserFailure,
    InvalidRequest,
    InternalError,
    OcrUnavailable,
    OcrUncertain,
}

#[derive(Clone, Debug, Serialize)]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: &'static str,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenge: Option<crate::contract::Challenge>,
}

impl CoreError {
    pub fn new(code: ErrorCode) -> Self {
        use ErrorCode::*;
        let message = match code {
            NetworkError => "Unable to reach SRM.",
            Timeout => "SRM request timed out.",
            TlsError => "SRM HTTPS certificate validation failed.",
            InvalidCredentials => "SRM rejected the credentials.",
            CaptchaRequired => "Enter the CAPTCHA to continue.",
            CaptchaRejected => "SRM rejected the CAPTCHA. Enter the new challenge.",
            AccountLocked => "SRM reports that the account is locked.",
            SessionExpired => "The SRM session has expired. Sign in again.",
            SessionConflict => "SRM concurrent-session recovery failed.",
            UnexpectedResponse => "SRM returned an unexpected response.",
            ParserFailure => "Unable to parse the SRM page.",
            InvalidRequest => "Invalid native request.",
            InternalError => "The native operation could not complete.",
            OcrUnavailable => "Local OCR is unavailable. Enter the CAPTCHA manually.",
            OcrUncertain => "Local OCR is uncertain. Enter the CAPTCHA manually.",
        };
        Self {
            code,
            message,
            retryable: matches!(
                code,
                NetworkError
                    | Timeout
                    | CaptchaRequired
                    | CaptchaRejected
                    | OcrUnavailable
                    | OcrUncertain
            ),
            challenge: None,
        }
    }
    pub fn with_challenge(mut self, challenge: crate::contract::Challenge) -> Self {
        self.challenge = Some(challenge);
        self
    }
}
impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message)
    }
}
impl std::error::Error for CoreError {}
pub type Result<T> = std::result::Result<T, CoreError>;
