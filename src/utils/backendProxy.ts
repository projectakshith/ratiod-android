/**
 * Ratio'd — Native Android & Web Backend Adapter
 * Bridges Next.js frontend calls to the on-device native Android plugin
 * (NativeCore Rust + TinyCRNN OCR or OkHttp fallback)
 * or falls back to HTTP proxy in web development.
 */

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function extractRefreshSections(sec: any, isPortal: boolean, fallbackUsername?: string) {
  const attSection = sec?.attendance?.ok ? sec.attendance.data : { attendance: [], monthly: [] };
  const profSection = sec?.profile?.ok ? sec.profile.data : (fallbackUsername ? { name: fallbackUsername, regNo: fallbackUsername } : {});
  const marksSection = sec?.marks?.ok ? sec.marks.data : { marks: [] };
  const ttSection = sec?.timetable?.ok ? sec.timetable.data : { schedule: {}, courses: {} };

  return {
    success: true,
    isPortal,
    attendance: attSection.attendance || [],
    monthly: attSection.monthly || [],
    profile: profSection || {},
    marks: marksSection.marks || [],
    schedule: ttSection.schedule || {},
    timetable: ttSection.schedule || {},
    courses: ttSection.courses || {}
  };
}

async function handleNativeBridge(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const plugin = (window as any).Capacitor?.Plugins?.PortalProbe;
  if (!plugin) {
    throw new Error("Capacitor PortalProbe plugin not found");
  }

  const isNative = await plugin.isNativeReady().then((r: any) => Boolean(r?.ready)).catch(() => false);

  // -------------------------------------------------------------
  // PATH A: NativeCore Engine (Rust + TinyCRNN OCR + JNI)
  // -------------------------------------------------------------
  if (isNative) {
    // 1. Portal CAPTCHA
    if (endpoint === "/portal/captcha") {
      try {
        const res = await plugin.nativeInvoke({
          request: { apiVersion: 1, service: "portal", method: "loadCaptcha" }
        });
        const challenge = res.data || res.error?.challenge;
        if (challenge) {
          return jsonResponse({
            session: challenge.challengeId,
            cdigest: challenge.challengeId,
            image: challenge.image,
            captcha_image: challenge.image,
            ocrStatus: challenge.ocrStatus || "available"
          });
        }
        return jsonResponse({ detail: res.error?.message || "Failed to load portal captcha" }, 503);
      } catch (e: any) {
        return jsonResponse({ detail: e.message || "Native CAPTCHA exception" }, 503);
      }
    }

    // 2. Portal Login
    if (endpoint === "/portal/login") {
      try {
        const creds = JSON.parse((options.body as string) || "{}");
        const hasManualCaptcha = Boolean(creds.captcha && creds.captcha.trim().length > 0);
        const loginReq: any = {
          apiVersion: 1,
          service: "portal",
          method: "login",
          username: creds.username,
          password: creds.password,
          useOcr: !hasManualCaptcha
        };
        const challengeId = creds.cdigest || creds.session || creds.challengeId;
        if (challengeId) {
          loginReq.challengeId = challengeId;
        }
        if (hasManualCaptcha) {
          loginReq.captchaAnswer = creds.captcha.trim();
        }

        const loginRes = await plugin.nativeInvoke({ request: loginReq });

        if (loginRes.ok) {
          // Refresh fresh data via NativeCore
          const refreshRes = await plugin.nativeInvoke({
            request: { apiVersion: 1, service: "portal", method: "refresh" }
          });
          const merged = extractRefreshSections(refreshRes.data?.sections, true, creds.username);
          return jsonResponse(merged);
        } else {
          const err = loginRes.error || {};
          if (err.code === "CAPTCHA_REQUIRED" || err.code === "CAPTCHA_REJECTED") {
            const ch = err.challenge;
            return jsonResponse({
              success: false,
              detail: {
                type: "WRONG_CAPTCHA",
                image: ch?.image,
                captcha_image: ch?.image,
                cdigest: ch?.challengeId,
                session: ch?.challengeId,
                message: err.message || "Enter the CAPTCHA to continue."
              }
            }, 401);
          }
          return jsonResponse({
            success: false,
            detail: err.message || "Portal login failed"
          }, 401);
        }
      } catch (e: any) {
        return jsonResponse({ detail: e.message || "Portal login exception" }, 500);
      }
    }

    // 3. Academia Login
    if (endpoint === "/login") {
      try {
        const creds = JSON.parse((options.body as string) || "{}");
        const loginReq: any = {
          apiVersion: 1,
          service: "academia",
          method: "login",
          username: creds.username,
          password: creds.password,
          useOcr: false
        };
        const challengeId = creds.cdigest || creds.challengeId;
        if (challengeId) {
          loginReq.challengeId = challengeId;
        }
        if (creds.captcha) {
          loginReq.captchaAnswer = creds.captcha.trim();
        }

        const loginRes = await plugin.nativeInvoke({ request: loginReq });

        if (loginRes.ok) {
          const refreshRes = await plugin.nativeInvoke({
            request: { apiVersion: 1, service: "academia", method: "refresh" }
          });
          const merged = extractRefreshSections(refreshRes.data?.sections, false, creds.username);
          return jsonResponse(merged);
        } else {
          const err = loginRes.error || {};
          if (err.code === "CAPTCHA_REQUIRED" || err.code === "CAPTCHA_REJECTED") {
            const ch = err.challenge;
            return jsonResponse({
              success: false,
              detail: {
                type: "CAPTCHA_REQUIRED",
                image: ch?.image,
                captcha_image: ch?.image,
                cdigest: ch?.challengeId,
                session: ch?.challengeId,
                message: err.message || "CAPTCHA required"
              }
            }, 401);
          }
          return jsonResponse({
            success: false,
            detail: err.message || "Invalid credentials"
          }, 401);
        }
      } catch (e: any) {
        return jsonResponse({ detail: e.message || "Academia login failed" }, 500);
      }
    }

    // 4. Data Refresh
    if (endpoint === "/portal/refresh") {
      try {
        const refreshRes = await plugin.nativeInvoke({
          request: { apiVersion: 1, service: "portal", method: "refresh" }
        });
        if (refreshRes.ok) {
          const merged = extractRefreshSections(refreshRes.data?.sections, true);
          return jsonResponse(merged);
        }
        return jsonResponse({ detail: refreshRes.error?.message || "Refresh failed" }, 500);
      } catch (e: any) {
        return jsonResponse({ detail: e.message || "Refresh failed" }, 500);
      }
    }

    if (endpoint === "/refresh") {
      try {
        const refreshRes = await plugin.nativeInvoke({
          request: { apiVersion: 1, service: "academia", method: "refresh" }
        });
        if (refreshRes.ok) {
          const merged = extractRefreshSections(refreshRes.data?.sections, false);
          return jsonResponse(merged);
        }
        return jsonResponse({ detail: refreshRes.error?.message || "Refresh failed" }, 500);
      } catch (e: any) {
        return jsonResponse({ detail: e.message || "Refresh failed" }, 500);
      }
    }
  }

  // -------------------------------------------------------------
  // PATH B: Java OkHttp Probe Fallback
  // -------------------------------------------------------------

  // 1. Portal CAPTCHA Challenge
  if (endpoint === "/portal/captcha") {
    try {
      const data = await plugin.loadCaptcha();
      const sid = data.nonce || "sess_" + Date.now();
      return jsonResponse({
        session: sid,
        cdigest: sid,
        image: data.captchaImage,
        captcha_image: data.captchaImage,
        exposedText: data.exposedCaptchaText || "",
        nonce: data.nonce,
        domainFieldName: data.domainFieldName,
        captchaFieldName: data.captchaFieldName,
        randomDelimiter: data.randomDelimiter,
        loginFormFields: data.loginFormFields || {}
      });
    } catch (e: any) {
      return jsonResponse({ detail: e.message || "Failed to load portal captcha" }, 503);
    }
  }

  // 2. Portal Authentication
  if (endpoint === "/portal/login") {
    try {
      const creds = JSON.parse((options.body as string) || "{}");
      const nowMs = Date.now();
      const elapsedSec = Math.max(3, Math.floor(Math.random() * 3 + 3));
      const reversedDomain = "sp.srmist.edu.in".split("").reverse().join("");
      const dtoken = btoa(reversedDomain);
      const cptoken = btoa(`${elapsedSec}00003`);
      const fpPayload = btoa(JSON.stringify({ fp: "", nonce: creds.cdigest || "", ts: nowMs }));
      const telemetry = btoa(JSON.stringify({
        screenWidth: window.screen.width || 1080,
        screenHeight: window.screen.height || 2400,
        devicePixelRatio: window.devicePixelRatio || 2,
        startTime: nowMs - 4000,
        submitTime: nowMs,
      }));

      const loginRes = await plugin.login({
        username: creds.username,
        password: creds.password,
        captcha: creds.captcha || "",
        domainFieldName: "dtoken_x",
        captchaFieldName: "cptoken_x",
        dtoken: dtoken,
        cptoken: cptoken,
        fpPayload: fpPayload,
        telemetryPayload: telemetry,
        loginFormFields: creds.loginFormFields || {}
      });

      if (loginRes.ok) {
        const attRes = await plugin.getAttendance();
        return jsonResponse({
          success: true,
          isPortal: true,
          attendance: attRes.courses || [],
          monthly: attRes.monthly || [],
          cookies: loginRes.cookies || {},
        });
      } else {
        const isWrongCaptcha = loginRes.reason === "wrong_captcha";
        if (isWrongCaptcha) {
          let freshImage = null;
          let freshSid = null;
          try {
            const cap = await plugin.loadCaptcha();
            freshImage = cap.captchaImage;
            freshSid = cap.nonce;
          } catch {}

          return jsonResponse({
            success: false,
            detail: {
              type: "WRONG_CAPTCHA",
              image: freshImage,
              captcha_image: freshImage,
              cdigest: freshSid,
              session: freshSid,
              message: loginRes.message || "Invalid captcha. Please enter the new one."
            }
          }, 401);
        }

        return jsonResponse({
          success: false,
          detail: loginRes.message || "Login failed"
        }, 401);
      }
    } catch (e: any) {
      return jsonResponse({ detail: e.message || "Portal login exception" }, 500);
    }
  }

  // 3. Academia Authentication
  if (endpoint === "/login") {
    try {
      const creds = JSON.parse((options.body as string) || "{}");
      const res = await plugin.loginAcademia({
        username: creds.username,
        password: creds.password,
        captcha: creds.captcha || null,
        cdigest: creds.cdigest || null,
      });

      if (res.ok) {
        return jsonResponse({
          success: true,
          isPortal: false,
          attendance: res.attendance || [],
          profile: res.profile || { name: creds.username, regNo: creds.username },
          cookies: res.cookies || {},
        });
      } else {
        if (res.reason === "captcha_required") {
          return jsonResponse({
            success: false,
            detail: {
              type: "CAPTCHA_REQUIRED",
              image: res.captchaImage,
              captcha_image: res.captchaImage,
              cdigest: res.cdigest,
              message: res.message || "Captcha required"
            }
          }, 401);
        }
        return jsonResponse({
          success: false,
          detail: res.message || "Invalid credentials"
        }, 401);
      }
    } catch (e: any) {
      return jsonResponse({ detail: e.message || "Academia login failed" }, 500);
    }
  }

  // 4. Data Refresh
  if (endpoint === "/portal/refresh") {
    try {
      const attRes = await plugin.getAttendance();
      return jsonResponse({
        success: true,
        attendance: attRes.courses || [],
        monthly: attRes.monthly || []
      });
    } catch (e: any) {
      return jsonResponse({ detail: e.message || "Refresh failed" }, 500);
    }
  }

  if (endpoint === "/refresh") {
    try {
      const attRes = await plugin.getAcademiaAttendance();
      return jsonResponse({
        success: true,
        attendance: attRes.courses || [],
      });
    } catch (e: any) {
      return jsonResponse({ detail: e.message || "Refresh failed" }, 500);
    }
  }

  // 5. Captcha Auto-Solve
  if (endpoint === "/captcha/solve") {
    return jsonResponse({
      ok: false,
      detail: "On-device OCR active natively."
    }, 200);
  }

  // 6. Announcements / Feedback
  if (endpoint === "/api/announcements") {
    return jsonResponse({ announcements: [] }, 200);
  }

  if (endpoint === "/feedback") {
    return jsonResponse({ success: true, message: "Feedback received locally" }, 200);
  }

  return jsonResponse({ detail: `Endpoint ${endpoint} not mapped natively` }, 404);
}

export async function fetchWithLoadBalancer(endpoint: string, options: RequestInit = {}, timeoutMs = 25000): Promise<Response> {
  const isCapacitorNative = typeof window !== 'undefined' && 
    (Boolean((window as any).Capacitor?.isNativePlatform()) || Boolean((window as any).Capacitor?.Plugins?.PortalProbe));

  // If on Android running natively via Capacitor, route directly to device plugin
  if (isCapacitorNative) {
    return handleNativeBridge(endpoint, options);
  }

  // Browser development fallback
  const isLocal = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
  const isDev = isLocal || 
    process.env.NODE_ENV === "development" || 
    process.env.NEXT_PUBLIC_ENV === "development";

  const urls = (process.env.NEXT_PUBLIC_BACKEND_URLS || "").split(",").filter(Boolean);
  const localBackend = urls.find(u => u.includes("localhost")) || "http://localhost:8000";
  const portalAuthHost = process.env.NEXT_PUBLIC_PORTAL_AUTH_URL;

  const isPortalAuthEndpoint = endpoint.startsWith("/portal/") || endpoint === "/captcha/solve";
  let targetUrl = isDev
    ? localBackend
    : (isPortalAuthEndpoint && portalAuthHost)
    ? portalAuthHost
    : urls[0] || localBackend;

  if (targetUrl.endsWith('/')) {
    targetUrl = targetUrl.slice(0, -1);
  }

  const fullUrl = `${targetUrl}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(fullUrl, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}
