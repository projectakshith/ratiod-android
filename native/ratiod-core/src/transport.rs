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
        read_page(request.send().map_err(map_error)?)
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
        read_page(response)
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
fn read_page(response: Response) -> Result<Page> {
    let status = response.status().as_u16();
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
        .map_err(|_| CoreError::new(ErrorCode::NetworkError))?;
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
pub fn map_error(error: reqwest::Error) -> CoreError {
    if error.is_timeout() {
        return CoreError::new(ErrorCode::Timeout);
    }
    let mut source: Option<&(dyn Error + 'static)> = Some(&error);
    while let Some(cause) = source {
        if cause.downcast_ref::<rustls::Error>().is_some() {
            return CoreError::new(ErrorCode::TlsError);
        }
        source = cause.source();
    }
    CoreError::new(
        if error.is_connect() || error.is_request() || error.is_body() {
            ErrorCode::NetworkError
        } else {
            ErrorCode::UnexpectedResponse
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
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
