use crate::{
    academia::Academia,
    contract::{API_VERSION, Envelope, Request, Response, Service},
    error::{CoreError, ErrorCode, Result},
    portal::{Portal, now_ms},
    transport::{ACADEMIA_BASE, PORTAL_LOGIN, Transport},
};
use serde_json::{Value, json};
use std::path::Path;

pub struct Core {
    pub(crate) portal: Portal,
    pub(crate) academia: Academia,
    solver: Option<Box<dyn tinyocr::Solver>>,
}
impl Core {
    pub fn new(model: &Path, vocab: &Path) -> Result<Self> {
        // Runtime loading may panic when the optional DLL/.so is missing. Manual login survives.
        let solver = std::panic::catch_unwind(|| tinyocr::Engine::load(model, vocab))
            .ok()
            .and_then(std::result::Result::ok)
            .map(|e| Box::new(e) as Box<dyn tinyocr::Solver>);
        Ok(Self {
            portal: Portal::new()?,
            academia: Academia::new()?,
            solver,
        })
    }
    pub fn without_ocr() -> Result<Self> {
        Ok(Self {
            portal: Portal::new()?,
            academia: Academia::new()?,
            solver: None,
        })
    }
    pub fn invoke(&mut self, input: &str) -> String {
        let result = serde_json::from_str::<Envelope>(input)
            .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))
            .and_then(|envelope| {
                if envelope.api_version != API_VERSION {
                    return Err(CoreError::new(ErrorCode::InvalidRequest));
                }
                self.dispatch(envelope.request)
            });
        serde_json::to_string(&Response::from_result(result)).unwrap_or_else(|_|"{\"apiVersion\":1,\"ok\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"The native operation could not complete.\",\"retryable\":false}}".into())
    }
    fn dispatch(&mut self, request: Request) -> Result<Value> {
        match request {
            Request::CheckReachability { service } => {
                let http = Transport::new(service)?;
                let start = now_ms();
                let page = http.get(match service {
                    Service::Portal => PORTAL_LOGIN,
                    Service::Academia => ACADEMIA_BASE,
                })?;
                page.successful()?;
                Ok(
                    json!({"reachable":true,"status":page.status,"latencyMs":now_ms().saturating_sub(start)}),
                )
            }
            Request::LoadCaptcha { service } => to_value(match service {
                Service::Portal => self.portal.load_captcha(),
                Service::Academia => self.academia.challenge(),
            }?),
            Request::Login {
                service,
                username,
                password,
                challenge_id,
                captcha_answer,
                use_ocr,
            } => {
                match service {
                    Service::Portal => {
                        if use_ocr {
                            self.portal.login(
                                username,
                                password,
                                challenge_id.as_deref(),
                                captcha_answer.as_deref(),
                                &mut self.solver,
                            )?;
                        } else {
                            self.portal.login_manual(
                                username,
                                password,
                                challenge_id.as_deref(),
                                captcha_answer.as_deref().unwrap_or(""),
                            )?;
                        }
                    }
                    Service::Academia => self.academia.login(
                        username,
                        password,
                        challenge_id.as_deref(),
                        captcha_answer.as_deref(),
                    )?,
                }
                Ok(json!({"authenticated":true,"service":service}))
            }
            Request::GetSessionState { service } => Ok(
                json!({"authenticated":match service{Service::Portal=>self.portal.authenticated,Service::Academia=>self.academia.authenticated},"service":service}),
            ),
            Request::ClearSession { service } => {
                match service {
                    Service::Portal => self.portal = Portal::new()?,
                    Service::Academia => self.academia = Academia::new()?,
                };
                Ok(json!({"cleared":true}))
            }
            Request::GetAttendance { service } => to_value(match service {
                Service::Portal => self.portal.attendance(),
                Service::Academia => self.academia.attendance(),
            }?),
            Request::GetProfile { service } => to_value(match service {
                Service::Portal => self.portal.profile(),
                Service::Academia => self.academia.profile(),
            }?),
            Request::GetMarks { service } => Ok(
                json!({"marks":match service{Service::Portal=>self.portal.marks(),Service::Academia=>self.academia.marks()}?}),
            ),
            Request::GetTimetable { service } => to_value(match service {
                Service::Portal => self.portal.timetable(),
                Service::Academia => self.academia.timetable(),
            }?),
            Request::Refresh { service } => self.refresh(service),
        }
    }
    fn reauthenticate(&mut self, service: Service) -> Result<()> {
        match service {
            Service::Portal => {
                let c = self
                    .portal
                    .credentials
                    .as_ref()
                    .ok_or_else(|| CoreError::new(ErrorCode::SessionExpired))?;
                let (username, password) = (c.username.to_string(), c.password.to_string());
                self.portal.authenticated = false;
                self.portal.load_captcha()?;
                self.portal
                    .login(username, password, None, None, &mut self.solver)
            }
            Service::Academia => {
                let c = self
                    .academia
                    .credentials
                    .as_ref()
                    .ok_or_else(|| CoreError::new(ErrorCode::SessionExpired))?;
                let (username, password) = (c.username.to_string(), c.password.to_string());
                self.academia.login(username, password, None, None)
            }
        }
    }
    fn refresh(&mut self, service: Service) -> Result<Value> {
        let mut attendance = match service {
            Service::Portal => self.portal.attendance(),
            Service::Academia => self.academia.attendance(),
        };
        if matches!(&attendance,Err(e)if matches!(e.code,ErrorCode::SessionExpired|ErrorCode::SessionConflict))
        {
            self.reauthenticate(service)?;
            attendance = match service {
                Service::Portal => self.portal.attendance(),
                Service::Academia => self.academia.attendance(),
            };
        }
        let attendance = attendance?;
        let (profile, marks, timetable) = std::thread::scope(|scope| {
            let p = scope.spawn(|| match service {
                Service::Portal => self.portal.profile(),
                Service::Academia => self.academia.profile(),
            });
            let m = scope.spawn(|| match service {
                Service::Portal => self.portal.marks(),
                Service::Academia => self.academia.marks(),
            });
            let t = scope.spawn(|| match service {
                Service::Portal => self.portal.timetable(),
                Service::Academia => self.academia.timetable(),
            });
            (
                p.join()
                    .unwrap_or_else(|_| Err(CoreError::new(ErrorCode::InternalError))),
                m.join()
                    .unwrap_or_else(|_| Err(CoreError::new(ErrorCode::InternalError))),
                t.join()
                    .unwrap_or_else(|_| Err(CoreError::new(ErrorCode::InternalError))),
            )
        });
        Ok(json!({"service":service,"sections":{
            "attendance":section(Ok(attendance)),"profile":section(profile),"marks":section(marks.map(|m|json!({"marks":m}))),"timetable":section(timetable)
        }}))
    }
}
fn to_value<T: serde::Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|_| CoreError::new(ErrorCode::InternalError))
}
fn section<T: serde::Serialize>(result: Result<T>) -> Value {
    match result {
        Ok(data) => json!({"ok":true,"data":data,"refreshedAt":now_ms()}),
        Err(error) => json!({"ok":false,"error":error}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contract_accepts_valid_calls_and_rejects_unknown_fields() {
        let mut core = Core::without_ocr().unwrap();
        let valid =
            core.invoke(r#"{"apiVersion":1,"method":"getSessionState","service":"portal"}"#);
        assert!(
            serde_json::from_str::<Value>(&valid).unwrap()["ok"] == true,
            "{valid}"
        );
        for invalid in [
            r#"{"apiVersion":2,"method":"getSessionState","service":"portal"}"#,
            r#"{"apiVersion":1,"method":"getSessionState","service":"portal","cookies":"secret-canary"}"#,
            r#"{"apiVersion":1,"method":"unknown","password":"password-canary"}"#,
        ] {
            let wire = core.invoke(invalid);
            assert!(wire.contains("INVALID_REQUEST") && !wire.contains("canary"));
        }
    }
}
