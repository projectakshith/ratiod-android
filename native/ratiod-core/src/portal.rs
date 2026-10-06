use crate::{
    contract::{Challenge, OcrStatus, Service},
    error::{CoreError, ErrorCode, Result},
    models::AttendanceData,
    parsers,
    transport::{PORTAL_BASE, PORTAL_LOGIN, Transport},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use regex::Regex;
use scraper::Html;
use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub(crate) struct Credentials {
    pub username: Zeroizing<String>,
    pub password: Zeroizing<String>,
}
impl Credentials {
    pub fn new(username: String, password: String) -> Self {
        Self {
            username: Zeroizing::new(username),
            password: Zeroizing::new(password),
        }
    }
}
pub(crate) struct PortalChallenge {
    pub public: Challenge,
    pub bytes: Vec<u8>,
    nonce: Zeroizing<String>,
    fields: BTreeMap<String, String>,
    domain_field: String,
    captcha_field: String,
    delimiter: String,
    loaded_at: u64,
}

pub struct Portal {
    pub(crate) http: Transport,
    pub(crate) credentials: Option<Credentials>,
    pub(crate) challenge: Option<PortalChallenge>,
    pub(crate) authenticated: bool,
}
impl Portal {
    fn page(&self, path: &str) -> Result<String> {
        if !self.authenticated {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        let page = self.http.get(&format!("{PORTAL_BASE}{path}"))?;
        Ok(page.authenticated()?.to_owned())
    }
    pub fn profile(&self) -> Result<crate::models::Profile> {
        crate::portal_parsers::profile(&self.page("/students/report/studentPersonalDetails.jsp")?)
    }
    pub fn timetable(&self) -> Result<crate::models::TimetableData> {
        if !self.authenticated {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        let form = vec![
            ("iden".into(), "10".into()),
            ("filter".into(), String::new()),
            ("hdnFormDetails".into(), "1".into()),
            ("csrfPreventionSalt".into(), String::new()),
        ];
        let page = self.http.post(
            &format!("{PORTAL_BASE}/students/report/studentTimeTableDetails.jsp"),
            &form,
            PORTAL_LOGIN,
        )?;
        crate::portal_parsers::timetable(page.authenticated()?)
    }
    pub fn marks(&self) -> Result<Vec<crate::models::Marks>> {
        let html = self.page("/students/report/studentInternalMarkDetails.jsp")?;
        let mut subjects = crate::portal_parsers::marks_main(&html)?;
        // Bounded fan-out. Component request failures become a section failure.
        for batch in subjects.chunks_mut(4) {
            std::thread::scope(|scope| -> Result<()> {
                let jobs:Vec<_>=batch.iter_mut().map(|subject| scope.spawn(|| -> Result<()> {
                    if let Some(id)=&subject.id {
                        let fields=vec![("iden".into(),"1".into()),("hdnSubjectId".into(),id.clone()),("status".into(),subject.status.clone())];
                        let page=self.http.post(&format!("{PORTAL_BASE}/students/report/studentInternalMarkDetailsInner.jsp"),&fields,PORTAL_LOGIN)?;
                        subject.marks.assessments=crate::portal_parsers::marks_inner(page.authenticated()?)?;
                    }
                    Ok(())
                })).collect();
                for job in jobs {
                    job.join()
                        .map_err(|_| CoreError::new(ErrorCode::InternalError))??;
                }
                Ok(())
            })?;
        }
        let mut marks: Vec<_> = subjects.into_iter().map(|s| s.marks).collect();
        for course in self.attendance()?.attendance {
            if !marks
                .iter()
                .any(|m| m.course_code.eq_ignore_ascii_case(&course.code))
            {
                marks.push(crate::models::Marks {
                    course_code: course.code,
                    title: Some(course.title),
                    kind: "Internal".into(),
                    performance: "N/A".into(),
                    assessments: vec![],
                    total_got: None,
                    total_max: None,
                });
            }
        }
        Ok(marks)
    }
    pub(crate) fn login(
        &mut self,
        username: String,
        password: String,
        challenge_id: Option<&str>,
        answer: Option<&str>,
        solver: &mut Option<Box<dyn tinyocr::Solver>>,
    ) -> Result<()> {
        let initial = self.login_manual(username, password, challenge_id, answer.unwrap_or(""));
        if answer.is_some_and(|s| !s.is_empty())
            || !matches!(&initial, Err(e) if e.code == ErrorCode::CaptchaRequired)
        {
            return initial;
        }
        for _ in 0..4 {
            let challenge = self
                .challenge
                .as_mut()
                .ok_or_else(|| CoreError::new(ErrorCode::CaptchaRequired))?;
            let Some(solver) = solver.as_mut() else {
                return initial;
            };
            challenge.public.ocr_status = OcrStatus::Available;
            let prediction = match solver.predict(&challenge.bytes) {
                Ok(p) if p.score >= 0.90 && !p.text.is_empty() => p,
                Ok(_) => {
                    challenge.public.ocr_status = OcrStatus::Uncertain;
                    return Err(CoreError::new(ErrorCode::CaptchaRequired)
                        .with_challenge(challenge.public.clone()));
                }
                Err(_) => {
                    challenge.public.ocr_status = OcrStatus::Unavailable;
                    return Err(CoreError::new(ErrorCode::CaptchaRequired)
                        .with_challenge(challenge.public.clone()));
                }
            };
            let text = Zeroizing::new(prediction.text);
            match self.submit(&text) {
                Ok(()) => return Ok(()),
                Err(e) if e.code == ErrorCode::CaptchaRejected => {}
                Err(e) => return Err(e),
            }
        }
        Err(CoreError::new(ErrorCode::CaptchaRejected).with_challenge(
            self.challenge
                .as_ref()
                .ok_or_else(|| CoreError::new(ErrorCode::InternalError))?
                .public
                .clone(),
        ))
    }
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: Transport::new(Service::Portal)?,
            credentials: None,
            challenge: None,
            authenticated: false,
        })
    }
    pub fn load_captcha(&mut self) -> Result<Challenge> {
        self.http = self.http.fresh()?;
        self.authenticated = false;
        self.challenge = None;
        let page = self.http.get(PORTAL_LOGIN)?;
        page.successful()?;
        let html = page.text()?;
        let doc = Html::parse_document(html);
        let nonce = capture(html, r"nonce\s*:\s*'([^']+)'")
            .or_else(|| capture(html, r"SECURE_CONFIG\.nonce\s*=\s*'([^']+)'"))
            .or_else(|| {
                doc.select(&parsers::select("input#fpNonce"))
                    .next()
                    .and_then(|n| n.value().attr("value").map(str::to_owned))
            })
            .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
        let domain_field = capture(html, r#"domainFieldName\s*=\s*['"]([^'"]+)['"]"#)
            .unwrap_or_else(|| "dtoken_x".into());
        let captcha_field = capture(html, r#"captchaFieldName\s*=\s*['"]([^'"]+)['"]"#)
            .unwrap_or_else(|| "cptoken_x".into());
        let delimiter =
            capture(html, r"randomDelimiter\s*=\s*'([^']+)'").unwrap_or_else(|| "0000".into());
        let fields = doc
            .select(&parsers::select("input[name]"))
            .filter_map(|e| {
                e.value().attr("name").map(|n| {
                    (
                        n.to_owned(),
                        e.value().attr("value").unwrap_or("").to_owned(),
                    )
                })
            })
            .collect();
        let segment = capture(html, r#"(SCaptchaServlet[^'"\s<]*)"#)
            .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
        let proof = STANDARD.encode(format!("{nonce}:sp.srmist.edu.in"));
        let image = self.http.get_headers(
            &format!("{PORTAL_BASE}/{segment}"),
            &[
                ("X-Domain-Proof", &proof),
                ("Accept", "image/png, image/jpeg, image/svg+xml, image/*"),
                ("Referer", PORTAL_LOGIN),
            ],
        )?;
        image.successful()?;
        if image.bytes.is_empty() || image.bytes.len() > 1024 * 1024 {
            return Err(CoreError::new(ErrorCode::UnexpectedResponse));
        }
        let mime = match image.content_type.split(';').next().unwrap_or("") {
            "image/jpeg" => "image/jpeg",
            "image/webp" => "image/webp",
            "image/svg+xml" => "image/svg+xml",
            _ => "image/png",
        };
        let public = Challenge {
            challenge_id: uuid::Uuid::new_v4().to_string(),
            image: format!("data:{mime};base64,{}", STANDARD.encode(&image.bytes)),
            ocr_status: OcrStatus::Unavailable,
        };
        self.challenge = Some(PortalChallenge {
            public: public.clone(),
            bytes: image.bytes,
            nonce: Zeroizing::new(nonce),
            fields,
            domain_field,
            captcha_field,
            delimiter,
            loaded_at: now_ms(),
        });
        Ok(public)
    }
    pub fn login_manual(
        &mut self,
        username: String,
        password: String,
        challenge_id: Option<&str>,
        answer: &str,
    ) -> Result<()> {
        let mut credentials = Credentials::new(username, password);
        credentials.username = Zeroizing::new(
            credentials
                .username
                .trim()
                .split('@')
                .next()
                .unwrap_or("")
                .to_owned(),
        );
        if credentials.username.is_empty()
            || credentials.password.is_empty()
            || (!answer.is_empty() && challenge_id.is_none())
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        if let Some(id) = challenge_id
            && self
                .challenge
                .as_ref()
                .is_none_or(|c| c.public.challenge_id != id)
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        // Every challenge already belongs to a fresh, unauthenticated cookie jar.
        self.authenticated = false;
        self.credentials = Some(credentials);
        if self.challenge.is_none() {
            self.load_captcha()?;
        }
        if answer.is_empty() {
            return Err(CoreError::new(ErrorCode::CaptchaRequired)
                .with_challenge(self.challenge.as_ref().unwrap().public.clone()));
        }
        self.submit(answer)
    }
    pub(crate) fn submit(&mut self, answer: &str) -> Result<()> {
        self.authenticated = false;
        let challenge = self
            .challenge
            .as_ref()
            .ok_or_else(|| CoreError::new(ErrorCode::CaptchaRequired))?;
        let credentials = self
            .credentials
            .as_ref()
            .ok_or_else(|| CoreError::new(ErrorCode::InvalidRequest))?;
        let now = now_ms();
        let elapsed = ((now.saturating_sub(challenge.loaded_at)) / 1000).max(3);
        let mut fields = challenge.fields.clone();
        fields.insert("username".into(), credentials.username.to_string());
        fields.insert("password".into(), credentials.password.to_string());
        fields.insert("captcha".into(), answer.to_owned());
        fields.insert(
            "fpPayload".into(),
            STANDARD.encode(
                serde_json::to_vec(
                    &serde_json::json!({"fp":"", "nonce": challenge.nonce.as_str(), "ts":now}),
                )
                .unwrap(),
            ),
        );
        fields.insert("fpToken".into(), String::new());
        fields.insert("recaptchaToken".into(), String::new());
        fields.insert("telemetryPayload".into(), STANDARD.encode(serde_json::to_vec(&serde_json::json!({"startTime": now.saturating_sub(4000), "submitTime":now, "currentDomain":"sp.srmist.edu.in", "timezoneOffset":-330,"screenWidth":1080,"screenHeight":2400,"colorDepth":24,"devicePixelRatio":2,"platform":"Linux armv8l","userAgent":"Mozilla/5.0 (Linux; Android 14; Mobile)","language":"en-US","hardwareConcurrency":8,"deviceMemory":8,"touchSupport":true,"webdriver":false,"mouseClicks":3,"mouseMovements":10,"keystrokeCount":0,"typingSpeedMs":0,"canvasHash":"000000","timeOnPageMs":4000})).unwrap()));
        fields.insert(
            challenge.domain_field.clone(),
            STANDARD.encode("ni.ude.tsimrs.ps"),
        );
        fields.insert(
            challenge.captcha_field.clone(),
            STANDARD.encode(format!("{elapsed}{}3", challenge.delimiter)),
        );
        let payload = Zeroizing::new(fields.into_iter().collect::<Vec<_>>());
        let response = self.http.post(
            &format!("{PORTAL_BASE}/LoginServlet"),
            &payload,
            PORTAL_LOGIN,
        )?;
        response.successful()?;
        let body = response.text()?;
        // Parse explicit rejection before probing authenticated data.
        if let Some(error) = rejection(body) {
            if error.code == ErrorCode::CaptchaRejected {
                self.challenge = None;
                let challenge = self.load_captcha()?;
                return Err(error.with_challenge(challenge));
            }
            if matches!(
                error.code,
                ErrorCode::InvalidCredentials | ErrorCode::AccountLocked
            ) {
                self.credentials = None;
            }
            return Err(error);
        }
        let attendance = self.http.get(&format!(
            "{PORTAL_BASE}/students/report/studentAttendanceDetails.jsp"
        ))?;
        parsers::portal_attendance(attendance.authenticated()?)?;
        self.authenticated = true;
        self.challenge = None;
        Ok(())
    }
    pub fn attendance(&self) -> Result<AttendanceData> {
        if !self.authenticated {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        let page = self.http.get(&format!(
            "{PORTAL_BASE}/students/report/studentAttendanceDetails.jsp"
        ))?;
        parsers::portal_attendance(page.authenticated()?)
    }
}
pub(crate) fn capture(text: &str, pattern: &str) -> Option<String> {
    Regex::new(pattern)
        .expect("static regex")
        .captures(text)
        .and_then(|m| m.get(1).map(|v| v.as_str().to_owned()))
}
fn rejection(html: &str) -> Option<CoreError> {
    let document = Html::parse_document(html);
    let alert = document
        .select(&parsers::select(".alert-icon-content, .alert-danger"))
        .next()?;
    let message = parsers::text(alert).to_lowercase();
    let code = if message.contains("captcha") {
        ErrorCode::CaptchaRejected
    } else if message.contains("locked") {
        ErrorCode::AccountLocked
    } else if message.contains("invalid")
        || message.contains("credential")
        || message.contains("unsuccessful")
        || message.contains("user id or password")
        || message.contains("attempts remaining")
    {
        ErrorCode::InvalidCredentials
    } else {
        ErrorCode::UnexpectedResponse
    };
    Some(CoreError::new(code))
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::MockServer;
    #[test]
    fn rejected_credentials_and_account_lock_stop_ocr_immediately() {
        for (message, expected) in [
            (
                "Invalid credentials password-canary",
                ErrorCode::InvalidCredentials,
            ),
            ("Account locked cookie-canary", ErrorCode::AccountLocked),
        ] {
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method("GET")
                    .path("/srmiststudentportal/students/loginManager/youLogin.jsp");
                then.status(200)
                    .body("<input id='fpNonce' value='nonce'><img src='SCaptchaServlet'>");
            });
            server.mock(|when, then| {
                when.method("GET")
                    .path("/srmiststudentportal/SCaptchaServlet");
                then.status(200).body("fake-image");
            });
            let submit = server.mock(|when, then| {
                when.method("POST")
                    .path("/srmiststudentportal/LoginServlet");
                then.status(200)
                    .body(format!("<div class='alert-danger'>{message}</div>"));
            });
            let mut portal = Portal::new().unwrap();
            portal.http = Transport::for_test(Service::Portal, server.base_url());
            let mut solver: Option<Box<dyn tinyocr::Solver>> =
                Some(Box::new(FixedSolver { uncertain: false }));
            let error = portal
                .login(
                    "example".into(),
                    "password-canary".into(),
                    None,
                    None,
                    &mut solver,
                )
                .unwrap_err();
            assert_eq!(error.code, expected);
            assert!(!serde_json::to_string(&error).unwrap().contains("canary"));
            assert!(portal.credentials.is_none() && !portal.authenticated);
            submit.assert_calls(1);
        }
    }
    #[test]
    fn stale_manual_challenge_is_rejected_without_submission() {
        let mut portal = Portal::new().unwrap();
        assert_eq!(
            portal
                .login_manual(
                    "example".into(),
                    "password-canary".into(),
                    Some("stale-id"),
                    "answer-canary"
                )
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
    }
    #[test]
    fn unknown_tables_do_not_become_successful_empty_marks() {
        let unexpected = "<table><tr><td>Maintenance</td></tr></table>";
        assert!(
            matches!(crate::portal_parsers::marks_inner(unexpected), Err(e) if e.code == ErrorCode::ParserFailure)
        );
        assert!(
            matches!(crate::portal_parsers::marks_main(unexpected), Err(e) if e.code == ErrorCode::ParserFailure)
        );
        assert!(
            matches!(crate::academic_parsers::marks(unexpected), Err(e) if e.code == ErrorCode::ParserFailure)
        );
        let empty = "<table><tr><th>Course Code</th><th>Internal Marks</th></tr></table>";
        assert!(crate::portal_parsers::marks_main(empty).unwrap().is_empty());
        assert!(crate::academic_parsers::marks(empty).unwrap().is_empty());
        assert!(crate::portal_parsers::marks_inner("<table><thead><tr><th>Component Name</th><th>Marks</th></tr></thead><tbody></tbody></table>").unwrap().is_empty());
    }
    #[test]
    fn portal_marks_fetch_components_and_match_python() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method("GET")
                .path("/srmiststudentportal/students/report/studentInternalMarkDetails.jsp");
            then.status(200)
                .body(include_str!("../tests/fixtures/portal-marks.html"));
        });
        let inner = server.mock(|when, then| {
            when.method("POST")
                .path("/srmiststudentportal/students/report/studentInternalMarkDetailsInner.jsp")
                .body_includes("hdnSubjectId=synthetic-subject")
                .body_includes("status=2");
            then.status(200)
                .body(include_str!("../tests/fixtures/portal-inner.html"));
        });
        server.mock(|when, then| {
            when.method("GET")
                .path("/srmiststudentportal/students/report/studentAttendanceDetails.jsp");
            then.status(200)
                .body(include_str!("../tests/fixtures/portal-attendance.html"));
        });
        let mut portal = Portal::new().unwrap();
        portal.http = Transport::for_test(Service::Portal, server.base_url());
        portal.authenticated = true;
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/expected.json")).unwrap();
        assert_eq!(
            serde_json::to_value(portal.marks().unwrap()).unwrap(),
            expected["portalMarks"]
        );
        inner.assert_calls(1);
    }
    struct FixedSolver {
        uncertain: bool,
    }
    impl tinyocr::Solver for FixedSolver {
        fn predict(
            &mut self,
            _: &[u8],
        ) -> std::result::Result<tinyocr::Prediction, tinyocr::error::AppError> {
            Ok(tinyocr::Prediction {
                text: "answer-canary".into(),
                score: if self.uncertain { 0.1 } else { 1.0 },
            })
        }
    }
    #[test]
    fn ocr_retry_limit_and_uncertain_manual_fallback() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method("GET")
                .path("/srmiststudentportal/students/loginManager/youLogin.jsp");
            then.status(200)
                .body("<input id='fpNonce' value='nonce'><img src='SCaptchaServlet'>");
        });
        server.mock(|when, then| {
            when.method("GET")
                .path("/srmiststudentportal/SCaptchaServlet");
            then.status(200).body("fake-image");
        });
        let submit = server.mock(|when, then| {
            when.method("POST")
                .path("/srmiststudentportal/LoginServlet");
            then.status(200)
                .body("<div class='alert-danger'>Invalid CAPTCHA answer-canary</div>");
        });
        let mut portal = Portal::new().unwrap();
        portal.http = Transport::for_test(Service::Portal, server.base_url());
        let mut solver: Option<Box<dyn tinyocr::Solver>> =
            Some(Box::new(FixedSolver { uncertain: false }));
        let error = portal
            .login(
                "example".into(),
                "password-canary".into(),
                None,
                None,
                &mut solver,
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::CaptchaRejected);
        assert!(error.challenge.is_some());
        submit.assert_calls(4);
        solver = Some(Box::new(FixedSolver { uncertain: true }));
        let error = portal
            .login(
                "example".into(),
                "password-canary".into(),
                None,
                None,
                &mut solver,
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::CaptchaRequired);
        assert!(matches!(
            error.challenge.unwrap().ocr_status,
            OcrStatus::Uncertain
        ));
        submit.assert_calls(4);
    }
    #[test]
    fn direct_challenge_login_and_attendance_keep_cookies_native() {
        let server = MockServer::start();
        server.mock(|when, then| { when.method("GET").path("/srmiststudentportal/students/loginManager/youLogin.jsp"); then.status(200).header("set-cookie", "JSESSIONID=secret-canary; Path=/").body("<input value='nonce-canary' id='fpNonce'><script>domainFieldName='dtoken_42';captchaFieldName='cptoken_42';randomDelimiter='9876';</script><img src='SCaptchaServlet'>"); });
        server.mock(|when, then| {
            when.method("GET")
                .path("/srmiststudentportal/SCaptchaServlet")
                .header("cookie", "JSESSIONID=secret-canary");
            then.status(200)
                .header("content-type", "image/png")
                .body("fake-image");
        });
        let login = server.mock(|when, then| {
            when.method("POST")
                .path("/srmiststudentportal/LoginServlet")
                .body_includes("dtoken_42=")
                .body_includes("cptoken_42=")
                .body_includes("password=password-canary");
            then.status(200).body("<html>dashboard</html>");
        });
        server.mock(|when, then| { when.method("GET").path("/srmiststudentportal/students/report/studentAttendanceDetails.jsp").header("cookie", "JSESSIONID=secret-canary"); then.status(200).body("<h1>Attendance</h1><table><tr><td>21CSC101J</td><td>Example</td><td>10</td><td>8</td><td>2</td><td>80</td></tr></table>"); });
        let mut portal = Portal::new().unwrap();
        portal.http = Transport::for_test(Service::Portal, server.base_url());
        let challenge = portal.load_captcha().unwrap();
        let wire = serde_json::to_string(&challenge).unwrap();
        assert!(!wire.contains("nonce-canary") && !wire.contains("secret-canary"));
        portal
            .login_manual(
                "test@example.invalid".into(),
                "password-canary".into(),
                Some(&challenge.challenge_id),
                "answer-canary",
            )
            .unwrap();
        assert_eq!(portal.attendance().unwrap().attendance[0].present, 8);
        login.assert_calls(1);
    }
    #[test]
    fn rejection_never_echoes_upstream_secrets() {
        let e = rejection(
            "<div class='alert-danger'>invalid credentials password-canary cookie-canary</div>",
        )
        .unwrap();
        assert_eq!(e.code, ErrorCode::InvalidCredentials);
        assert!(!serde_json::to_string(&e).unwrap().contains("canary"));
    }
}
