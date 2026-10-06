use crate::error::CoreError;
use serde::{Deserialize, Serialize};

pub const API_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Academia,
    Portal,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub challenge_id: String,
    pub image: String,
    pub ocr_status: OcrStatus,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OcrStatus {
    Available,
    Unavailable,
    Uncertain,
}

// Intentionally no Debug/Serialize: passwords and CAPTCHA answers are input-only.
#[derive(Deserialize)]
#[serde(tag = "method", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "checkReachability")]
    CheckReachability { service: Service },
    #[serde(rename = "loadCaptcha")]
    LoadCaptcha { service: Service },
    #[serde(rename = "login")]
    Login {
        service: Service,
        username: String,
        password: String,
        #[serde(default)]
        challenge_id: Option<String>,
        #[serde(default)]
        captcha_answer: Option<String>,
        #[serde(default = "default_true")]
        use_ocr: bool,
    },
    #[serde(rename = "getSessionState")]
    GetSessionState { service: Service },
    #[serde(rename = "getAttendance")]
    GetAttendance { service: Service },
    #[serde(rename = "getProfile")]
    GetProfile { service: Service },
    #[serde(rename = "getMarks")]
    GetMarks { service: Service },
    #[serde(rename = "getTimetable")]
    GetTimetable { service: Service },
    #[serde(rename = "refresh")]
    Refresh { service: Service },
    #[serde(rename = "clearSession")]
    ClearSession { service: Service },
}
fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub api_version: u32,
    #[serde(flatten)]
    pub request: Request,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Response<T: Serialize> {
    Success {
        #[serde(rename = "apiVersion")]
        api_version: u32,
        ok: bool,
        data: T,
    },
    Failure {
        #[serde(rename = "apiVersion")]
        api_version: u32,
        ok: bool,
        error: CoreError,
    },
}
impl<T: Serialize> Response<T> {
    pub fn from_result(result: crate::error::Result<T>) -> Self {
        match result {
            Ok(data) => Self::Success {
                api_version: API_VERSION,
                ok: true,
                data,
            },
            Err(error) => Self::Failure {
                api_version: API_VERSION,
                ok: false,
                error,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn input_secrets_never_appear_in_error_responses() {
        let error = CoreError::new(crate::error::ErrorCode::InvalidCredentials);
        let wire = serde_json::to_string(&Response::<()>::from_result(Err(error))).unwrap();
        assert!(!wire.contains("password"));
        assert!(!wire.contains("cookie"));
        assert!(wire.contains("INVALID_CREDENTIALS"));
    }
}
