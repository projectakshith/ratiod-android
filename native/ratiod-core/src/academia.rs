use crate::{
    academic_parsers,
    contract::{Challenge, OcrStatus, Service},
    error::{CoreError, ErrorCode, Result},
    models::*,
    parsers::{select, text},
    portal::Credentials,
    transport::{ACADEMIA_BASE, Transport},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::Url;
use scraper::Html;
use std::collections::BTreeMap;
use zeroize::Zeroizing;

const LOGIN: &str = "https://academia.srmist.edu.in/accounts/signin.ac";
const PROFILE: &str = "/srm_university/academia-academic-services/page/My_Time_Table_2023_24";
const ATTENDANCE: &str = "/srm_university/academia-academic-services/page/My_Attendance";
pub struct Academia {
    pub(crate) http: Transport,
    pub(crate) credentials: Option<Credentials>,
    pub(crate) authenticated: bool,
    challenge: Option<(Challenge, Zeroizing<String>)>,
}

impl Academia {
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: Transport::new(Service::Academia)?,
            credentials: None,
            authenticated: false,
            challenge: None,
        })
    }
    pub fn challenge(&self) -> Result<Challenge> {
        self.challenge
            .as_ref()
            .map(|(c, _)| c.clone())
            .ok_or_else(|| CoreError::new(ErrorCode::CaptchaRequired))
    }
    pub fn login(
        &mut self,
        username: String,
        password: String,
        id: Option<&str>,
        answer: Option<&str>,
    ) -> Result<()> {
        let credentials = Credentials::new(username, password);
        let manual = answer.is_some_and(|s| !s.is_empty());
        if credentials.username.trim().is_empty()
            || credentials.password.is_empty()
            || (manual && id.is_none())
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        if let Some(id) = id
            && self
                .challenge
                .as_ref()
                .is_none_or(|(c, _)| c.challenge_id != id)
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        if manual
            && self
                .credentials
                .as_ref()
                .is_none_or(|c| c.username.as_str() != credentials.username.as_str())
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        if !manual {
            self.http = self.http.fresh()?;
            self.challenge = None;
        }
        self.authenticated = false;
        self.credentials = Some(credentials);
        for attempt in 0..2 {
            let credentials = self.credentials.as_ref().unwrap();
            let mut form = vec![
                ("username".into(), credentials.username.to_string()),
                ("password".into(), credentials.password.to_string()),
                ("client_portal".into(), "true".into()),
                ("portal".into(), "10002227248".into()),
                ("servicename".into(), "ZohoCreator".into()),
                ("serviceurl".into(), format!("{ACADEMIA_BASE}/")),
                ("is_ajax".into(), "true".into()),
                ("grant_type".into(), "password".into()),
                ("service_language".into(), "en".into()),
            ];
            if let Some((_, digest)) = &self.challenge {
                form.push(("cdigest".into(), digest.to_string()));
            }
            if let Some(answer) = answer {
                form.push(("captcha".into(), answer.into()));
            }
            let form = Zeroizing::new(form);
            let page = self.http.post(LOGIN, &form, &format!("{ACADEMIA_BASE}/"))?;
            page.successful()?;
            let html = page.text()?;
            if html.to_lowercase().contains("concurrent")
                && html.to_lowercase().contains("terminate")
            {
                if attempt == 0 {
                    self.terminate(html)?;
                    continue;
                }
                return Err(CoreError::new(ErrorCode::SessionConflict));
            }
            let json: serde_json::Value = serde_json::from_str(html).map_err(|_| {
                let body = html.to_lowercase();
                if body.contains("invalid credentials")
                    || body.contains("check your username/password")
                {
                    CoreError::new(ErrorCode::InvalidCredentials)
                } else {
                    CoreError::new(ErrorCode::UnexpectedResponse)
                }
            })?;
            if json["status"]
                .as_str()
                .is_some_and(|s| s.eq_ignore_ascii_case("fail"))
            {
                let code = json["code"].as_str().unwrap_or("");
                if code == "HIP_REQUIRED" || code == "HIP_FAILED" {
                    let digest = json["cdigest"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .ok_or_else(|| CoreError::new(ErrorCode::UnexpectedResponse))?;
                    let mut image_url = Url::parse(&format!(
                        "{ACADEMIA_BASE}/accounts/p/40-10002227248/webclient/v1/captcha/"
                    ))
                    .unwrap();
                    image_url
                        .path_segments_mut()
                        .map_err(|_| CoreError::new(ErrorCode::UnexpectedResponse))?
                        .pop_if_empty()
                        .push(digest);
                    image_url.set_query(Some("darkmode=false"));
                    let image = self.http.get(image_url.as_str())?;
                    image.successful()?;
                    if image.bytes.is_empty() || image.bytes.len() > 1024 * 1024 {
                        return Err(CoreError::new(ErrorCode::UnexpectedResponse));
                    }
                    let challenge = Challenge {
                        challenge_id: uuid::Uuid::new_v4().to_string(),
                        image: format!("data:image/png;base64,{}", STANDARD.encode(&image.bytes)),
                        ocr_status: OcrStatus::Unavailable,
                    };
                    self.challenge = Some((challenge.clone(), Zeroizing::new(digest.into())));
                    return Err(CoreError::new(if code == "HIP_FAILED" {
                        ErrorCode::CaptchaRejected
                    } else {
                        ErrorCode::CaptchaRequired
                    })
                    .with_challenge(challenge));
                }
                self.credentials = None;
                self.challenge = None;
                let locked = code.to_lowercase().contains("lock")
                    || json["error"]["msg"]
                        .as_str()
                        .is_some_and(|s| s.to_lowercase().contains("locked"));
                return Err(CoreError::new(if locked {
                    ErrorCode::AccountLocked
                } else {
                    ErrorCode::InvalidCredentials
                }));
            }
            let token = Zeroizing::new(
                json["data"]["access_token"]
                    .as_str()
                    .ok_or_else(|| CoreError::new(ErrorCode::InvalidCredentials))?
                    .to_owned(),
            );
            let redirect = json["data"]["oauthorize_uri"]
                .as_str()
                .ok_or_else(|| CoreError::new(ErrorCode::UnexpectedResponse))?;
            let mut url =
                Url::parse(redirect).map_err(|_| CoreError::new(ErrorCode::UnexpectedResponse))?;
            url.query_pairs_mut().append_pair("access_token", &token);
            self.http.get(url.as_str())?.successful()?;
            // Academia is used for timetable data. Validate the session on the
            // timetable page; Attendance can be unavailable independently.
            let page = self.http.get(&format!("{ACADEMIA_BASE}{PROFILE}"))?;
            let html = page.authenticated()?;
            if html.to_lowercase().contains("concurrent")
                && html.to_lowercase().contains("terminate")
            {
                if attempt == 0 {
                    self.terminate(html)?;
                    continue;
                }
                return Err(CoreError::new(ErrorCode::SessionConflict));
            }
            self.authenticated = true;
            self.challenge = None;
            return Ok(());
        }
        Err(CoreError::new(ErrorCode::SessionConflict))
    }
    fn terminate(&self, html: &str) -> Result<()> {
        let doc = Html::parse_document(html);
        let form = doc
            .select(&select("form"))
            .find(|f| {
                text(*f).to_lowercase().contains("terminate")
                    || f.select(&select("input[value='Terminate All Sessions']"))
                        .next()
                        .is_some()
            })
            .ok_or_else(|| CoreError::new(ErrorCode::SessionConflict))?;
        let action = form
            .value()
            .attr("action")
            .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
        let url = Url::parse(ACADEMIA_BASE)
            .unwrap()
            .join(action)
            .map_err(|_| CoreError::new(ErrorCode::UnexpectedResponse))?;
        let mut fields = BTreeMap::new();
        for n in form.select(&select("input[name], button[name]")) {
            fields.insert(
                n.value().attr("name").unwrap().into(),
                n.value().attr("value").unwrap_or("").into(),
            );
        }
        let fields = Zeroizing::new(fields.into_iter().collect::<Vec<(String, String)>>());
        self.http.post(url.as_str(), &fields, LOGIN)?.successful()
    }
    fn page(&self, path: &str) -> Result<String> {
        if !self.authenticated {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        let page = self.http.get(&format!("{ACADEMIA_BASE}{path}"))?;
        academic_parsers::extract(page.authenticated()?)
    }
    pub fn attendance(&self) -> Result<AttendanceData> {
        academic_parsers::attendance(&self.page(ATTENDANCE)?)
    }
    pub fn profile(&self) -> Result<Profile> {
        academic_parsers::profile(&self.page(PROFILE)?)
    }
    pub fn marks(&self) -> Result<Vec<Marks>> {
        academic_parsers::marks(&self.page(ATTENDANCE)?)
    }
    pub fn timetable(&self) -> Result<TimetableData> {
        let html = self.page(PROFILE)?;
        let profile = academic_parsers::profile(&html)?;
        let courses = academic_parsers::courses(&html)?;
        let batch = if profile.batch == "1" {
            "Batch_1"
        } else {
            "batch_2"
        };
        let grid = self.page(&format!(
            "/srm_university/academia-academic-services/page/Unified_Time_Table_2025_{batch}"
        ))?;
        let schedule = academic_parsers::timetable(&grid, &courses)?;
        Ok(TimetableData { profile: Some(profile), schedule, courses })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::MockServer;
    #[test]
    fn account_locked_and_unknown_manual_challenges_are_safe() {
        let server = MockServer::start();
        let login = server.mock(|when, then| {
            when.method("POST").path("/accounts/signin.ac");
            then.status(200).body(r#"{"status":"fail","code":"ACCOUNT_LOCKED","error":{"msg":"Account locked password-canary"}}"#);
        });
        let mut client = Academia::new().unwrap();
        client.http = Transport::for_test(Service::Academia, server.base_url());
        let error = client
            .login("example".into(), "password-canary".into(), None, None)
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::AccountLocked);
        assert!(!serde_json::to_string(&error).unwrap().contains("canary"));
        assert!(client.credentials.is_none());
        assert_eq!(
            client
                .login(
                    "example".into(),
                    "password-canary".into(),
                    Some("stale-id"),
                    Some("answer-canary")
                )
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        login.assert_calls(1);
    }
    #[test]
    fn concurrent_page_after_token_exchange_retries_only_once() {
        let server = MockServer::start();
        let login = server.mock(|when, then| {
            when.method("POST").path("/accounts/signin.ac");
            then.status(200).body(r#"{"data":{"access_token":"token-canary","oauthorize_uri":"https://academia.srmist.edu.in/exchange"}}"#);
        });
        server.mock(|when, then| {
            when.method("GET").path("/exchange");
            then.status(200);
        });
        server.mock(|when, then| {
            when.method("GET").path(ATTENDANCE);
            then.status(200).body(
                "concurrent sessions <form action='/terminate'><button>Terminate</button></form>",
            );
        });
        let terminate = server.mock(|when, then| {
            when.method("POST").path("/terminate");
            then.status(200);
        });
        let mut client = Academia::new().unwrap();
        client.http = Transport::for_test(Service::Academia, server.base_url());
        assert_eq!(
            client
                .login("example".into(), "password-canary".into(), None, None)
                .unwrap_err()
                .code,
            ErrorCode::SessionConflict
        );
        login.assert_calls(2);
        terminate.assert_calls(1);
        assert!(!client.authenticated);
    }
    #[test]
    fn academia_interactive_captcha_exchange_and_attendance() {
        let server = MockServer::start();
        let mut first = server.mock(|when, then| {
            when.method("POST").path("/accounts/signin.ac");
            then.status(200)
                .body(r#"{"status":"fail","code":"HIP_REQUIRED","cdigest":"digest-canary"}"#);
        });
        server.mock(|when, then| {
            when.method("GET")
                .path("/accounts/p/40-10002227248/webclient/v1/captcha/digest-canary");
            then.status(200).body("fake-image");
        });
        let mut client = Academia::new().unwrap();
        client.http = Transport::for_test(Service::Academia, server.base_url());
        let error = client
            .login("example".into(), "password-canary".into(), None, None)
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::CaptchaRequired);
        let challenge = error.challenge.unwrap();
        assert!(
            !serde_json::to_string(&challenge)
                .unwrap()
                .contains("digest-canary")
        );
        first.delete();
        let login=server.mock(|when,then|{when.method("POST").path("/accounts/signin.ac").body_includes("cdigest=digest-canary").body_includes("captcha=answer-canary");then.status(200).body(r#"{"data":{"access_token":"token-canary","oauthorize_uri":"https://academia.srmist.edu.in/exchange?from=login"}}"#);});
        server.mock(|when, then| {
            when.method("GET")
                .path("/exchange")
                .query_param("access_token", "token-canary");
            then.status(200)
                .header("set-cookie", "JSESSIONID=cookie-canary; Path=/")
                .body("ok");
        });
        server.mock(|when, then| {
            when.method("GET")
                .path(ATTENDANCE)
                .header("cookie", "JSESSIONID=cookie-canary");
            then.status(200)
                .body(include_str!("../tests/fixtures/academia.html"));
        });
        client
            .login(
                "example".into(),
                "password-canary".into(),
                Some(&challenge.challenge_id),
                Some("answer-canary"),
            )
            .unwrap();
        assert!(client.authenticated);
        assert_eq!(client.attendance().unwrap().attendance[0].present, 8);
        login.assert_calls(1);
    }
    #[test]
    fn concurrent_recovery_is_bounded_and_rejects_foreign_actions() {
        let server = MockServer::start();
        let login=server.mock(|when,then|{when.method("POST").path("/accounts/signin.ac");then.status(200).body("concurrent sessions <form action='/terminate'><button name='submit' value='yes'>Terminate All Sessions</button></form>");});
        let terminate = server.mock(|when, then| {
            when.method("POST").path("/terminate");
            then.status(200);
        });
        let mut client = Academia::new().unwrap();
        client.http = Transport::for_test(Service::Academia, server.base_url());
        assert_eq!(
            client
                .login("example".into(), "password-canary".into(), None, None)
                .unwrap_err()
                .code,
            ErrorCode::SessionConflict
        );
        login.assert_calls(2);
        terminate.assert_calls(1);
        assert_eq!(
            client
                .terminate(
                    "<form action='https://foreign.invalid'><button>Terminate</button></form>"
                )
                .unwrap_err()
                .code,
            ErrorCode::UnexpectedResponse
        );
    }
}
