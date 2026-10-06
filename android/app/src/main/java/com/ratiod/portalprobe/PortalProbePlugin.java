package com.ratiod.portalprobe;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.FormBody;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "PortalProbe")
public class PortalProbePlugin extends Plugin {
    private static final String TAG = "PortalProbe";

    private static final String BASE_URL = "https://sp.srmist.edu.in/srmiststudentportal";
    private static final String LOGIN_URL = "https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp";
    private static final String LOGIN_SERVLET = "https://sp.srmist.edu.in/srmiststudentportal/LoginServlet";
    private static final String ATT_URL = "https://sp.srmist.edu.in/srmiststudentportal/students/report/studentAttendanceDetails.jsp";

    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    // Strictly in-memory cookie storage (never written to disk or SharedPreferences)
    private final Map<String, List<Cookie>> inMemoryCookieJar = new ConcurrentHashMap<>();
    private OkHttpClient httpClient;

    @Override
    public void load() {
        super.load();
        initHttpClient();
        NativeCoreManager.getInstance().init(getContext());
    }

    @PluginMethod
    public void isNativeReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", NativeCoreManager.getInstance().isReady());
        call.resolve(ret);
    }

    @PluginMethod
    public void nativeInvoke(PluginCall call) {
        JSObject req = call.getObject("request");
        String requestJson;
        if (req != null) {
            requestJson = req.toString();
        } else {
            requestJson = call.getString("requestJson", "{}");
        }

        NativeCoreManager.getInstance().invoke(requestJson, new NativeCoreManager.NativeCallback() {
            @Override
            public void onResult(String responseJson) {
                try {
                    JSObject ret = new JSObject(responseJson);
                    call.resolve(ret);
                } catch (Exception e) {
                    JSObject ret = new JSObject();
                    ret.put("rawResponse", responseJson);
                    call.resolve(ret);
                }
            }

            @Override
            public void onError(Exception error) {
                call.reject(error != null ? error.getMessage() : "Unknown native error");
            }
        });
    }

    private synchronized void initHttpClient() {
        inMemoryCookieJar.clear();
        httpClient = new OkHttpClient.Builder()
                .cookieJar(new CookieJar() {
                    @Override
                    public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
                        List<Cookie> existing = inMemoryCookieJar.get(url.host());
                        if (existing == null) {
                            existing = new ArrayList<>();
                        }
                        // Merge cookies in RAM
                        for (Cookie newC : cookies) {
                            existing.removeIf(c -> c.name().equals(newC.name()));
                            existing.add(newC);
                        }
                        inMemoryCookieJar.put(url.host(), existing);
                    }

                    @Override
                    public List<Cookie> loadForRequest(HttpUrl url) {
                        List<Cookie> cookies = inMemoryCookieJar.get(url.host());
                        return cookies != null ? cookies : Collections.emptyList();
                    }
                })
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .build();
    }

    @PluginMethod
    public void checkReachability(PluginCall call) {
        new Thread(() -> {
            long start = System.currentTimeMillis();
            try {
                Request request = new Request.Builder()
                        .url(LOGIN_URL)
                        .header("User-Agent", USER_AGENT)
                        .build();

                try (Response response = httpClient.newCall(request).execute()) {
                    long latency = System.currentTimeMillis() - start;
                    JSObject ret = new JSObject();
                    ret.put("ok", response.isSuccessful());
                    ret.put("status", response.code());
                    ret.put("latencyMs", latency);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                long latency = System.currentTimeMillis() - start;
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("status", 0);
                ret.put("latencyMs", latency);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    @PluginMethod
    public void loadCaptcha(PluginCall call) {
        new Thread(() -> {
            try {
                Request request = new Request.Builder()
                        .url(LOGIN_URL)
                        .header("User-Agent", USER_AGENT)
                        .build();

                String html;
                try (Response response = httpClient.newCall(request).execute()) {
                    if (!response.isSuccessful()) {
                        call.reject("Failed to fetch login page: HTTP " + response.code());
                        return;
                    }
                    ResponseBody body = response.body();
                    html = body != null ? body.string() : "";
                }

                // 1. Nonce
                String nonce = null;
                Matcher m = Pattern.compile("window\\.SECURE_CONFIG\\s*=\\s*\\{[^}]*?nonce\\s*:\\s*'([^']+)'").matcher(html);
                if (m.find()) {
                    nonce = m.group(1);
                }
                if (nonce == null) {
                    m = Pattern.compile("id=\"fpNonce\"\\s*value=\"([^\"]+)\"").matcher(html);
                    if (m.find()) nonce = m.group(1);
                }

                // 2. Domain Field Name
                String domainFieldName = "dtoken_x";
                m = Pattern.compile("domainFieldName\\s*=\\s*['\"]([^'\"]+)['\"]").matcher(html);
                if (m.find()) domainFieldName = m.group(1);

                // 3. Captcha Field Name
                String captchaFieldName = "cptoken_x";
                m = Pattern.compile("captchaFieldName\\s*=\\s*['\"]([^'\"]+)['\"]").matcher(html);
                if (m.find()) captchaFieldName = m.group(1);

                // 4. Random Delimiter
                String randomDelimiter = "0000";
                m = Pattern.compile("randomDelimiter\\s*=\\s*'([^']+)'").matcher(html);
                if (m.find()) randomDelimiter = m.group(1);

                // 5. Exposed Captcha Text
                String exposedCaptchaText = "";
                m = Pattern.compile("\"captchaText\"\\s*:\\s*\"([^\"]+)\"").matcher(html);
                if (!m.find()) {
                    m = Pattern.compile("captchaText\\s*=\\s*'([^']+)'").matcher(html);
                }
                if (m.find()) exposedCaptchaText = m.group(1);

                // 6. Form fields
                JSObject formFields = new JSObject();
                m = Pattern.compile("<input[^>]*name=['\"]([^'\"]+)['\"][^>]*>").matcher(html);
                while (m.find()) {
                    formFields.put(m.group(1), "");
                }

                // 7. Captcha image URL
                String captchaUrl = null;
                m = Pattern.compile("SCaptchaServlet[^'\"\\s]*").matcher(html);
                if (m.find()) {
                    String seg = m.group(0);
                    captchaUrl = seg.startsWith("/") ? "https://sp.srmist.edu.in" + seg : BASE_URL + "/" + seg;
                }

                String imgBase64 = null;
                if (captchaUrl != null) {
                    String proof = Base64.encodeToString(
                            ((nonce != null ? nonce : "") + ":sp.srmist.edu.in").getBytes(StandardCharsets.UTF_8),
                            Base64.NO_WRAP
                    );

                    Request captchaReq = new Request.Builder()
                            .url(captchaUrl)
                            .header("User-Agent", USER_AGENT)
                            .header("X-Domain-Proof", proof)
                            .header("Accept", "image/png, image/jpeg, image/svg+xml, image/*")
                            .header("Referer", LOGIN_URL)
                            .build();

                    try (Response cr = httpClient.newCall(captchaReq).execute()) {
                        if (cr.isSuccessful() && cr.body() != null) {
                            byte[] imgBytes = cr.body().bytes();
                            imgBase64 = "data:image/png;base64," + Base64.encodeToString(imgBytes, Base64.NO_WRAP);
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("nonce", nonce);
                ret.put("domainFieldName", domainFieldName);
                ret.put("captchaFieldName", captchaFieldName);
                ret.put("randomDelimiter", randomDelimiter);
                ret.put("exposedCaptchaText", exposedCaptchaText);
                ret.put("loginFormFields", formFields);
                ret.put("captchaImage", imgBase64);

                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Error loading captcha: " + e.getMessage(), e);
                call.reject("Error loading captcha: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void login(PluginCall call) {
        new Thread(() -> {
            try {
                String username = call.getString("username");
                String password = call.getString("password");
                String captcha = call.getString("captcha");
                String domainFieldName = call.getString("domainFieldName", "dtoken_x");
                String captchaFieldName = call.getString("captchaFieldName", "cptoken_x");
                String dtoken = call.getString("dtoken");
                String cptoken = call.getString("cptoken");
                String fpPayload = call.getString("fpPayload");
                String telemetryPayload = call.getString("telemetryPayload");
                JSObject formFields = call.getObject("loginFormFields");

                FormBody.Builder formBuilder = new FormBody.Builder();

                if (formFields != null) {
                    Iterator<String> keys = formFields.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (!key.equals("username") && !key.equals("password") && !key.equals("captcha")) {
                            formBuilder.add(key, formFields.optString(key, ""));
                        }
                    }
                }

                formBuilder.add("username", username != null ? username : "");
                formBuilder.add("password", password != null ? password : "");
                formBuilder.add("captcha", captcha != null ? captcha : "");
                formBuilder.add("fpPayload", fpPayload != null ? fpPayload : "");
                formBuilder.add("fpToken", "");
                formBuilder.add("recaptchaToken", "");
                formBuilder.add("telemetryPayload", telemetryPayload != null ? telemetryPayload : "");
                formBuilder.add(domainFieldName, dtoken != null ? dtoken : "");
                formBuilder.add(captchaFieldName, cptoken != null ? cptoken : "");

                Request postReq = new Request.Builder()
                        .url(LOGIN_SERVLET)
                        .header("User-Agent", USER_AGENT)
                        .header("Origin", "https://sp.srmist.edu.in")
                        .header("Referer", LOGIN_URL)
                        .post(formBuilder.build())
                        .build();

                String respBody;
                String finalUrl;
                try (Response resp = httpClient.newCall(postReq).execute()) {
                    respBody = resp.body() != null ? resp.body().string() : "";
                    finalUrl = resp.request().url().toString().toLowerCase();
                }

                boolean isSuccess = finalUrl.contains("logout.jsp")
                        || finalUrl.contains("attendance")
                        || finalUrl.contains("hrdsystem");

                if (!isSuccess) {
                    // Test if attendance page is accessible with current session
                    Request checkReq = new Request.Builder()
                            .url(ATT_URL)
                            .header("User-Agent", USER_AGENT)
                            .build();

                    try (Response attResp = httpClient.newCall(checkReq).execute()) {
                        String attBody = attResp.body() != null ? attResp.body().string() : "";
                        String attUrl = attResp.request().url().toString().toLowerCase();
                        if (attResp.isSuccessful() && !attUrl.contains("youlogin") && !attBody.toLowerCase().contains("loginform")) {
                            isSuccess = true;
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("ok", isSuccess);

                if (isSuccess) {
                    JSObject cookiesObj = new JSObject();
                    List<Cookie> cookies = inMemoryCookieJar.get("sp.srmist.edu.in");
                    if (cookies != null) {
                        for (Cookie c : cookies) {
                            cookiesObj.put(c.name(), c.value());
                        }
                    }
                    ret.put("cookies", cookiesObj);
                    call.resolve(ret);
                } else {
                    String reason = "login_failed";
                    String message = "Login failed";

                    // Parse alert from HTML response
                    Matcher alertMatcher = Pattern.compile("class=['\"][^'\"]*(?:alert-icon-content|alert-danger)[^'\"]*['\"][^>]*>([\\s\\S]*?)</(?:div|span|p)>").matcher(respBody);
                    if (alertMatcher.find()) {
                        String alertText = alertMatcher.group(1).replaceAll("<[^>]*>", "").trim();
                        if (alertText.toLowerCase().startsWith("alert")) {
                            alertText = alertText.substring(5).trim();
                        }
                        message = alertText;
                        String lower = alertText.toLowerCase();
                        if (lower.contains("captcha")) {
                            reason = "wrong_captcha";
                        } else if (lower.contains("locked")) {
                            reason = "account_locked";
                        } else if (lower.contains("invalid") || lower.contains("credential") || lower.contains("unsuccessful")) {
                            reason = "invalid_credentials";
                        }
                    }

                    ret.put("reason", reason);
                    ret.put("message", message);
                    call.resolve(ret);
                }

            } catch (Exception e) {
                Log.e(TAG, "Login exception: " + e.getMessage(), e);
                call.reject("Login exception: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void getAttendance(PluginCall call) {
        new Thread(() -> {
            try {
                Request request = new Request.Builder()
                        .url(ATT_URL)
                        .header("User-Agent", USER_AGENT)
                        .build();

                String html;
                try (Response response = httpClient.newCall(request).execute()) {
                    String url = response.request().url().toString().toLowerCase();
                    if (!response.isSuccessful() || url.contains("youlogin") || url.contains("login")) {
                        JSObject err = new JSObject();
                        err.put("ok", false);
                        err.put("reason", "session_expired");
                        err.put("message", "Session is dead or redirected to login.");
                        call.resolve(err);
                        return;
                    }
                    html = response.body() != null ? response.body().string() : "";
                }

                if (html.toLowerCase().contains("loginform") || html.toLowerCase().contains("thegr8loginloader")) {
                    JSObject err = new JSObject();
                    err.put("ok", false);
                    err.put("reason", "session_expired");
                    err.put("message", "Session expired.");
                    call.resolve(err);
                    return;
                }

                // Parse attendance HTML table
                JSArray courses = new JSArray();
                JSArray monthly = new JSArray();

                // Simple regex parser for <tr>...</tr> and <td>...</td>
                Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
                while (trMatcher.find()) {
                    String rowContent = trMatcher.group(1);
                    Matcher tdMatcher = Pattern.compile("<(?:td|th)[^>]*>([\\s\\S]*?)</(?:td|th)>", Pattern.CASE_INSENSITIVE).matcher(rowContent);
                    List<String> cells = new ArrayList<>();
                    while (tdMatcher.find()) {
                        String cellText = tdMatcher.group(1).replaceAll("<[^>]*>", "").trim();
                        cells.add(cellText);
                    }

                    if (cells.isEmpty()) continue;

                    String firstCell = cells.get(0);
                    // Match course code pattern e.g. 21CSE101, 18CSC302J, etc.
                    if (firstCell.matches("^[A-Z0-9]{6,12}$") && cells.size() >= 6) {
                        try {
                            JSObject course = new JSObject();
                            course.put("code", firstCell);
                            course.put("title", cells.get(1));
                            course.put("conducted", Integer.parseInt(cells.get(2)));
                            course.put("present", Integer.parseInt(cells.get(3)));
                            course.put("absent", Integer.parseInt(cells.get(4)));
                            course.put("percent", Double.parseDouble(cells.get(5)));
                            courses.put(course);
                        } catch (NumberFormatException ignored) {}
                    } else if (firstCell.matches("^[A-Za-z]{3}-\\d{4}$") && cells.size() >= 3) {
                        try {
                            JSObject month = new JSObject();
                            month.put("month", firstCell);
                            month.put("present", Integer.parseInt(cells.get(1)));
                            month.put("absent", Integer.parseInt(cells.get(2)));
                            monthly.put(month);
                        } catch (NumberFormatException ignored) {}
                    }
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("courses", courses);
                ret.put("monthly", monthly);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Error fetching attendance: " + e.getMessage(), e);
                call.reject("Error fetching attendance: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        initHttpClient();
        NativeCoreManager.getInstance().destroy();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getSessionState(PluginCall call) {
        JSObject ret = new JSObject();
        List<Cookie> cookies = inMemoryCookieJar.get("sp.srmist.edu.in");
        if (cookies == null || cookies.isEmpty()) {
            cookies = inMemoryCookieJar.get("academia.srmist.edu.in");
        }
        JSArray names = new JSArray();
        if (cookies != null) {
            for (Cookie c : cookies) {
                names.put(c.name());
            }
        }
        ret.put("authenticated", cookies != null && !cookies.isEmpty());
        ret.put("cookies", names);
        call.resolve(ret);
    }

    @PluginMethod
    public void loginAcademia(PluginCall call) {
        new Thread(() -> {
            try {
                String username = call.getString("username");
                String password = call.getString("password");
                String captcha = call.getString("captcha");
                String cdigest = call.getString("cdigest");

                FormBody.Builder form = new FormBody.Builder()
                        .add("username", username != null ? username : "")
                        .add("password", password != null ? password : "")
                        .add("client_portal", "true")
                        .add("portal", "10002227248")
                        .add("servicename", "ZohoCreator")
                        .add("serviceurl", "https://academia.srmist.edu.in/")
                        .add("is_ajax", "true")
                        .add("grant_type", "password")
                        .add("service_language", "en");

                if (cdigest != null && !cdigest.isEmpty()) {
                    form.add("cdigest", cdigest);
                }
                if (captcha != null && !captcha.isEmpty()) {
                    form.add("captcha", captcha);
                }

                Request req = new Request.Builder()
                        .url("https://academia.srmist.edu.in/accounts/signin.ac")
                        .header("User-Agent", "Mozilla/5.0")
                        .header("Origin", "https://academia.srmist.edu.in")
                        .header("Referer", "https://academia.srmist.edu.in/")
                        .post(form.build())
                        .build();

                try (Response resp = httpClient.newCall(req).execute()) {
                    String respBody = resp.body() != null ? resp.body().string() : "";
                    JSONObject json = new JSONObject(respBody);

                    if ("fail".equalsIgnoreCase(json.optString("status"))) {
                        String code = json.optString("code");
                        if ("HIP_REQUIRED".equalsIgnoreCase(code) || "HIP_FAILED".equalsIgnoreCase(code)) {
                            String freshDigest = json.optString("cdigest");
                            JSObject err = new JSObject();
                            err.put("ok", false);
                            err.put("reason", "captcha_required");
                            err.put("cdigest", freshDigest);
                            err.put("captchaImage", "https://academia.srmist.edu.in/accounts/p/40-10002227248/webclient/v1/captcha/" + freshDigest + "?darkmode=false");
                            err.put("message", json.optString("message", "Captcha required"));
                            call.resolve(err);
                            return;
                        }
                        JSObject err = new JSObject();
                        err.put("ok", false);
                        err.put("reason", "login_failed");
                        err.put("message", json.optJSONObject("error") != null ? json.optJSONObject("error").optString("msg") : "Login failed");
                        call.resolve(err);
                        return;
                    }

                    JSONObject dataObj = json.optJSONObject("data");
                    if (dataObj != null && dataObj.has("access_token")) {
                        String token = dataObj.getString("access_token");
                        String redirectUrl = dataObj.getString("oauthorize_uri");
                        String finalAuthUrl = redirectUrl + "&access_token=" + token;

                        Request finalReq = new Request.Builder()
                                .url(finalAuthUrl)
                                .header("User-Agent", "Mozilla/5.0")
                                .build();

                        try (Response finalResp = httpClient.newCall(finalReq).execute()) {
                            // JSESSIONID is now stored in cookie jar
                        }

                        JSArray courses = fetchAcademiaAttendanceInternal();

                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        ret.put("isPortal", false);
                        ret.put("attendance", courses);

                        JSObject profile = new JSObject();
                        profile.put("name", username);
                        profile.put("regNo", username);
                        ret.put("profile", profile);

                        JSObject cookiesObj = new JSObject();
                        List<Cookie> cookies = inMemoryCookieJar.get("academia.srmist.edu.in");
                        if (cookies != null) {
                            for (Cookie c : cookies) {
                                cookiesObj.put(c.name(), c.value());
                            }
                        }
                        ret.put("cookies", cookiesObj);

                        call.resolve(ret);
                        return;
                    }

                    JSObject err = new JSObject();
                    err.put("ok", false);
                    err.put("reason", "login_failed");
                    err.put("message", "Invalid credentials");
                    call.resolve(err);
                }
            } catch (Exception e) {
                Log.e(TAG, "Academia login error: " + e.getMessage(), e);
                call.reject("Academia login error: " + e.getMessage());
            }
        }).start();
    }

    private JSArray fetchAcademiaAttendanceInternal() {
        JSArray courses = new JSArray();
        try {
            Request req = new Request.Builder()
                    .url("https://academia.srmist.edu.in/srm_university/academia-academic-services/page/My_Attendance")
                    .header("User-Agent", "Mozilla/5.0")
                    .build();
            try (Response resp = httpClient.newCall(req).execute()) {
                if (!resp.isSuccessful()) return courses;
                String html = resp.body() != null ? resp.body().string() : "";

                Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
                while (trMatcher.find()) {
                    String row = trMatcher.group(1);
                    Matcher tdMatcher = Pattern.compile("<td[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE).matcher(row);
                    List<String> cells = new ArrayList<>();
                    while (tdMatcher.find()) {
                        cells.add(tdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                    }
                    if (cells.size() >= 9) {
                        String code = cells.get(0).replaceAll("Regular", "").trim();
                        if (code.matches("^[A-Z0-9]{8,12}.*")) {
                            try {
                                JSObject c = new JSObject();
                                c.put("code", code);
                                c.put("title", cells.get(1));
                                c.put("category", cells.get(2));
                                c.put("slot", cells.get(4));
                                int conducted = Integer.parseInt(cells.get(6));
                                int absent = Integer.parseInt(cells.get(7));
                                c.put("conducted", conducted);
                                c.put("absent", absent);
                                c.put("present", conducted - absent);
                                c.put("percent", Double.parseDouble(cells.get(8)));
                                courses.put(c);
                            } catch (Exception ignored) {}
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Academia attendance parsing error: " + e.getMessage());
        }
        return courses;
    }

    @PluginMethod
    public void getAcademiaAttendance(PluginCall call) {
        new Thread(() -> {
            JSArray courses = fetchAcademiaAttendanceInternal();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("courses", courses);
            call.resolve(ret);
        }).start();
    }
}
