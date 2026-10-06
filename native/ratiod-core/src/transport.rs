//! Validated HTTPS, isolated cookie jars and redacted errors.
use crate::{
    contract::Service,
    error::{CoreError, ErrorCode, Result},
};
use reqwest::{
    Url,
    blocking::{Client, Response},
    redirect::Policy,
};
use std::{error::Error, io::Read, time::Duration};

pub const PORTAL_BASE: &str = "https://sp.srmist.edu.in/srmiststudentportal";
pub const PORTAL_LOGIN: &str =
    "https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp";
pub const ACADEMIA_BASE: &str = "https://academia.srmist.edu.in";
const MAX_BODY: u64 = 4 * 1024 * 1024;

pub fn allowed(url: &Url, service: Service) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str()
            == Some(match service {
                Service::Academia => "academia.srmist.edu.in",
                Service::Portal => "sp.srmist.edu.in",
            })
}

pub struct Transport {
    client: Client,
    service: Service,
    // Test-only origin substitution; production never accepts configurable SRM URLs.
    #[cfg(test)]
    test_base: Option<String>,
}

impl Transport {
    pub fn new(service: Service) -> Result<Self> {
        let client = Client::builder()
            // Standard Mozilla trust anchors avoid a Java callback dependency in Rust TLS.
            .tls_certs_only(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().filter_map(|cert| reqwest::Certificate::from_der(cert.as_ref()).ok()))
            .cookie_store(true)
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(30))
            .https_only(true)
            .user_agent("Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")
            .redirect(Policy::custom(move |attempt| {
                if attempt.previous().len() >= 10 || !allowed(attempt.url(), service) { attempt.stop() } else { attempt.follow() }
            }))
            .build().map_err(map_error)?;
        Ok(Self {
            client,
            service,
            #[cfg(test)]
            test_base: None,
        })
    }
    #[cfg(test)]
    pub fn for_test(service: Service, base: String) -> Self {
        Self {
            client: Client::builder()
                .cookie_store(true)
                .redirect(Policy::none())
                .build()
                .unwrap(),
            service,
            test_base: Some(base),
        }
    }
    pub fn fresh(&self) -> Result<Self> {
        #[cfg(test)]
        if let Some(base) = &self.test_base {
            return Ok(Self::for_test(self.service, base.clone()));
        }
        Self::new(self.service)
    }
    fn url(&self, raw: &str) -> Result<Url> {
        let url = Url::parse(raw).map_err(|_| CoreError::new(ErrorCode::UnexpectedResponse))?;
        if !allowed(&url, self.service) {
            return Err(CoreError::new(ErrorCode::UnexpectedResponse));
        }
        #[cfg(test)]
        if let Some(base) = &self.test_base {
            return Url::parse(&format!(
                "{}{}{}",
                base,
                url.path(),
                url.query().map(|q| format!("?{q}")).unwrap_or_default()
            ))
            .map_err(|_| CoreError::new(ErrorCode::InternalError));
        }
        Ok(url)
    }
    pub fn get(&self, url: &str) -> Result<Page> {
        self.get_headers(url, &[])
    }
    pub fn get_headers(&self, url: &str, headers: &[(&str, &str)]) -> Result<Page> {
        let mut request = self.client.get(self.url(url)?);
        for (key, value) in headers {
            request = request.header(*key, *value);
        }
        read_page(request.send().map_err(map_error)?, self.service)
    }
    pub fn post(&self, url: &str, fields: &[(String, String)], referer: &str) -> Result<Page> {
        // No request or response tracing: bodies and redirect queries contain secrets.
        let origin = match self.service {
            Service::Academia => ACADEMIA_BASE,
            Service::Portal => "https://sp.srmist.edu.in",
        };
        let response = self
            .client
            .post(self.url(url)?)
            .header("Origin", origin)
            .header("Referer", referer)
            .form(fields)
            .send()
            .map_err(map_error)?;
        read_page(response, self.service)
    }
}

pub struct Page {
    pub status: u16,
    pub path: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}
impl Page {
    pub fn text(&self) -> Result<&str> {
        std::str::from_utf8(&self.bytes).map_err(|_| CoreError::new(ErrorCode::ParserFailure))
    }
    pub fn successful(&self) -> Result<()> {
        if (200..300).contains(&self.status) {
            Ok(())
        } else {
            Err(CoreError::new(ErrorCode::UnexpectedResponse))
        }
    }
    pub fn authenticated(&self) -> Result<&str> {
        if self.status == 401 || self.status == 403 || (300..400).contains(&self.status) {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        self.successful()?;
        let html = self.text()?;
        let path = self.path.to_lowercase();
        let body = html.to_lowercase();
        if path.contains("login")
            || path.contains("signin")
            || body.contains("loginform")
            || body.contains("login_form")
            || body.contains("thegr8loginloader")
        {
            return Err(CoreError::new(ErrorCode::SessionExpired));
        }
        Ok(html)
    }
}
fn read_page(response: Response, service: Service) -> Result<Page> {
    let status = response.status().as_u16();
    // Redirects stopped by the origin policy are unexpected, never a new session.
    if (300..400).contains(&status)
        && let Some(location) = response.headers().get("location")
    {
        let target = location
            .to_str()
            .ok()
            .and_then(|s| response.url().join(s).ok());
        if target.as_ref().is_none_or(|url| !allowed(url, service)) {
            return Err(CoreError::new(ErrorCode::UnexpectedResponse));
        }
    }
    let path = response.url().path().to_string(); // Intentionally discard query (Academia token exchange).
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if response.content_length().is_some_and(|n| n > MAX_BODY) {
        return Err(CoreError::new(ErrorCode::UnexpectedResponse));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_BODY + 1)
        .read_to_end(&mut bytes)
        .map_err(map_read_error)?;
    if bytes.len() as u64 > MAX_BODY {
        return Err(CoreError::new(ErrorCode::UnexpectedResponse));
    }
    Ok(Page {
        status,
        path,
        content_type,
        bytes,
    })
}
fn map_read_error(error: std::io::Error) -> CoreError {
    CoreError::new(cause_code(&error).unwrap_or(ErrorCode::NetworkError))
}
pub fn map_error(error: reqwest::Error) -> CoreError {
    if let Some(code) = cause_code(&error) {
        return CoreError::new(code);
    }
    CoreError::new(
        if error.is_connect() || error.is_request() || error.is_body() {
            ErrorCode::NetworkError
        } else {
            ErrorCode::UnexpectedResponse
        },
    )
}
fn cause_code(mut cause: &(dyn Error + 'static)) -> Option<ErrorCode> {
    for _ in 0..32 {
        if cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(|e| e.is_timeout())
        {
            return Some(ErrorCode::Timeout);
        }
        if cause.downcast_ref::<rustls::Error>().is_some() {
            return Some(ErrorCode::TlsError);
        }
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            if io.kind() == std::io::ErrorKind::TimedOut {
                return Some(ErrorCode::Timeout);
            }
            // io::Error::source can skip its wrapped error's own identity.
            if let Some(inner) = io.get_ref() {
                cause = inner;
                continue;
            }
        }
        cause = cause.source()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_timeout_foreign_redirect_and_untrusted_tls_are_distinct() {
        use std::{net::TcpListener, sync::Arc};
        let server = httpmock::MockServer::start();
        server.mock(|when, then| {
            when.method("GET").path("/slow");
            then.status(200).delay(Duration::from_millis(100));
        });
        let client = Client::builder()
            .timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        assert_eq!(
            map_error(
                client
                    .get(format!("{}/slow", server.base_url()))
                    .send()
                    .unwrap_err()
            )
            .code,
            ErrorCode::Timeout
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let closed = listener.local_addr().unwrap();
        drop(listener);
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            map_error(
                client
                    .get(format!("http://{closed}/password-canary"))
                    .send()
                    .unwrap_err()
            )
            .code,
            ErrorCode::NetworkError
        );
        server.mock(|when, then| {
            when.method("GET").path("/srmiststudentportal/foreign");
            then.status(302).header(
                "location",
                "https://foreign.invalid/?access_token=token-canary",
            );
        });
        let transport = Transport::for_test(Service::Portal, server.base_url());
        assert!(
            matches!(transport.get(&format!("{PORTAL_BASE}/foreign")), Err(e) if e.code == ErrorCode::UnexpectedResponse)
        );

        let generated = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let key =
            rustls::pki_types::PrivatePkcs8KeyDer::from(generated.signing_key.serialize_der());
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![generated.cert.der().clone()], key.into())
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
            let _ = connection.complete_io(&mut stream);
        });
        let client = Client::builder()
            .tls_certs_only(
                webpki_root_certs::TLS_SERVER_ROOT_CERTS
                    .iter()
                    .filter_map(|c| reqwest::Certificate::from_der(c.as_ref()).ok()),
            )
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let upstream = client
            .get(format!("https://127.0.0.1:{}/", address.port()))
            .send()
            .unwrap_err();
        let error = map_error(upstream);
        worker.join().unwrap();
        assert_eq!(error.code, ErrorCode::TlsError);
        assert!(!serde_json::to_string(&error).unwrap().contains("canary"));
    }
    #[test]
    fn origin_policy_blocks_cleartext_and_foreign_hosts() {
        for url in [
            "http://sp.srmist.edu.in/",
            "https://evil.test/",
            "https://sp.srmist.edu.in:444/",
            "https://user:secret@sp.srmist.edu.in/",
        ] {
            assert!(!allowed(&Url::parse(url).unwrap(), Service::Portal));
        }
        assert!(allowed(&Url::parse(PORTAL_LOGIN).unwrap(), Service::Portal));
        assert!(!allowed(
            &Url::parse(PORTAL_LOGIN).unwrap(),
            Service::Academia
        ));
    }
}
