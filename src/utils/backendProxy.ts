/**
 * Ratio'd — Native Android & Web Backend Adapter
 * Bridges Next.js frontend calls to the on-device native Android plugin
 * or falls back to HTTP proxy in web development.
 */

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function handleNativeBridge(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const plugin = (window as any).Capacitor?.Plugins?.PortalProbe;
  if (!plugin) {
    throw new Error("Capacitor PortalProbe plugin not found");
  }

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
        // Fetch fresh attendance immediately
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
          // Attempt to load a fresh captcha for retry
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
      detail: "On-device OCR manual fallback active."
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
