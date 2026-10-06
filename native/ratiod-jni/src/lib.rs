//! Stable JNI boundary. No raw pointers/handles cross into JavaScript.
use jni::{
    JNIEnv,
    objects::{JClass, JString},
    sys::{jlong, jstring},
};
use ratiod_core::{
    Core,
    contract::Response,
    error::{CoreError, ErrorCode},
};
use std::{
    collections::HashMap,
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
    sync::{
        Arc, Mutex, Once, OnceLock,
        atomic::{AtomicI64, Ordering},
    },
};
use zeroize::Zeroizing;

type Instance = Arc<Mutex<Option<Core>>>;
static INSTANCES: OnceLock<Mutex<HashMap<i64, Instance>>> = OnceLock::new();
static NEXT: AtomicI64 = AtomicI64::new(1);
static PANIC_HOOK: Once = Once::new();
fn registry() -> &'static Mutex<HashMap<i64, Instance>> {
    INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn failure(code: ErrorCode) -> String {
    serde_json::to_string(&Response::<()>::from_result(Err(CoreError::new(code))))
        .expect("fixed serializable error")
}
fn invoke(handle: i64, input: &str) -> String {
    if input.len() > 1024 * 1024 {
        return failure(ErrorCode::InvalidRequest);
    }
    let instance = registry().lock().ok().and_then(|r| r.get(&handle).cloned());
    let Some(instance) = instance else {
        return failure(ErrorCode::InvalidRequest);
    };
    match instance.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(core) => core.invoke(input),
            None => failure(ErrorCode::InvalidRequest),
        },
        Err(_) => failure(ErrorCode::InternalError),
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_ratiod_core_NativeCore_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    model: JString,
    vocab: JString,
) -> jlong {
    // Rust's default panic hook prints payloads. Suppress it before any native work.
    PANIC_HOOK.call_once(|| std::panic::set_hook(Box::new(|_| {})));
    catch_unwind(AssertUnwindSafe(|| {
        let model: String = env.get_string(&model).ok()?.into();
        let vocab: String = env.get_string(&vocab).ok()?.into();
        let core = Core::new(Path::new(&model), Path::new(&vocab)).ok()?;
        let mut registry = registry().lock().ok()?;
        if registry.len() >= 16 {
            return None;
        }
        let handle = NEXT.fetch_add(1, Ordering::Relaxed);
        if handle <= 0 {
            return None;
        }
        registry.insert(handle, Arc::new(Mutex::new(Some(core))));
        Some(handle)
    }))
    .ok()
    .flatten()
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_ratiod_core_NativeCore_nativeInvoke(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    input: JString,
) -> jstring {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let input: Zeroizing<String> = match env.get_string(&input) {
            Ok(s) => Zeroizing::new(s.into()),
            Err(_) => return failure(ErrorCode::InvalidRequest),
        };
        invoke(handle, &input)
    }))
    .unwrap_or_else(|_| failure(ErrorCode::InternalError));
    env.new_string(result)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_ratiod_core_NativeCore_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let instance = registry().lock().ok().and_then(|mut r| r.remove(&handle));
        if let Some(instance) = instance
            && let Ok(mut guard) = instance.lock()
        {
            guard.take();
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_handles_and_oversized_requests_are_safe() {
        assert!(invoke(-1, "password-canary").contains("INVALID_REQUEST"));
        assert!(!invoke(-1, "password-canary").contains("canary"));
        assert!(invoke(1, &"x".repeat(1024 * 1024 + 1)).contains("INVALID_REQUEST"));
    }
    #[test]
    fn registered_core_has_serialized_lifecycle() {
        let handle = NEXT.fetch_add(1, Ordering::Relaxed);
        registry().lock().unwrap().insert(
            handle,
            Arc::new(Mutex::new(Some(Core::without_ocr().unwrap()))),
        );
        let response = invoke(
            handle,
            r#"{"apiVersion":1,"method":"getSessionState","service":"academia"}"#,
        );
        assert!(serde_json::from_str::<serde_json::Value>(&response).unwrap()["ok"] == true);
        registry().lock().unwrap().remove(&handle);
        assert!(invoke(handle, "{}").contains("INVALID_REQUEST"));
    }
}
