package com.ratiod.portalprobe;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import com.ratiod.core.NativeCore;

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
    public void isNativeAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", NativeCore.isAvailable());
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

                if (captcha == null || captcha.trim().isEmpty()) {
                    JSObject err = new JSObject();
                    err.put("ok", false);
                    err.put("reason", "wrong_captcha");
                    err.put("message", "Security check required. Please enter the captcha.");
                    call.resolve(err);
                    return;
                }

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

                String reason = "login_failed";
                String message = "Login failed";
                boolean explicitRejection = false;

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
                        explicitRejection = true;
                    } else if (lower.contains("locked")) {
                        reason = "account_locked";
                        explicitRejection = true;
                    } else if (lower.contains("invalid") || lower.contains("credential") || lower.contains("unsuccessful") || lower.contains("attempts remaining")) {
                        reason = "invalid_credentials";
                        explicitRejection = true;
                    }
                }

                String respLower = respBody.toLowerCase();
                if (!explicitRejection && (finalUrl.contains("youlogin") || respLower.contains("invalid password") || respLower.contains("invalid credentials") || respLower.contains("wrong captcha"))) {
                    if (respLower.contains("captcha")) {
                        reason = "wrong_captcha";
                        message = "Invalid captcha. Please enter the new one.";
                    } else {
                        reason = "invalid_credentials";
                        message = "Invalid username or password.";
                    }
                    explicitRejection = true;
                }

                boolean isSuccess = false;
                JSArray courses = new JSArray();
                JSArray monthly = new JSArray();
                JSObject profile = new JSObject();

                if (!explicitRejection) {
                    Request checkReq = new Request.Builder()
                            .url(ATT_URL)
                            .header("User-Agent", USER_AGENT)
                            .build();

                    try (Response attResp = httpClient.newCall(checkReq).execute()) {
                        String attBody = attResp.body() != null ? attResp.body().string() : "";
                        String attUrl = attResp.request().url().toString().toLowerCase();
                        if (attResp.isSuccessful() && !attUrl.contains("youlogin") && !attBody.toLowerCase().contains("loginform") && !attBody.toLowerCase().contains("thegr8loginloader")) {
                            parsePortalAttendanceAndProfile(attBody, courses, monthly, profile);
                            if (courses.length() > 0 || (profile.has("name") && !profile.optString("name").isEmpty())) {
                                isSuccess = true;
                            }
                        }
                    }
                }

                if (!isSuccess) {
                    JSObject err = new JSObject();
                    err.put("ok", false);
                    err.put("reason", reason);
                    err.put("message", message);
                    call.resolve(err);
                    return;
                }

                JSObject tt = fetchPortalTimetableInternal();
                JSArray marks = fetchPortalMarksInternal();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("isPortal", true);
                ret.put("attendance", courses);
                ret.put("monthly", monthly);
                ret.put("profile", profile);
                ret.put("schedule", tt.getJSObject("schedule"));
                ret.put("timetable", tt.getJSObject("schedule"));
                ret.put("courses", tt.getJSObject("courses"));
                ret.put("marks", marks);

                JSObject cookiesObj = new JSObject();
                List<Cookie> cookies = inMemoryCookieJar.get("sp.srmist.edu.in");
                if (cookies != null) {
                    for (Cookie c : cookies) {
                        cookiesObj.put(c.name(), c.value());
                    }
                }
                ret.put("cookies", cookiesObj);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Login exception: " + e.getMessage(), e);
                call.reject("Login exception: " + e.getMessage());
            }
        }).start();
    }

    private void parsePortalAttendanceAndProfile(String html, JSArray courses, JSArray monthly, JSObject profile) {
        if (html == null || html.isEmpty()) return;

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

            if (cells.size() >= 2) {
                String label = cells.get(0).toLowerCase();
                String val = cells.get(1);
                if (label.contains("student name") || label.equals("name")) {
                    profile.put("name", val);
                } else if (label.contains("register no") || label.contains("registration no") || label.contains("reg no")) {
                    profile.put("regNo", val);
                } else if (label.contains("institution") || label.contains("department")) {
                    profile.put("dept", val);
                } else if (label.contains("program")) {
                    profile.put("program", val);
                } else if (label.contains("semester")) {
                    profile.put("semester", val);
                } else if (label.contains("section")) {
                    profile.put("section", val);
                } else if (label.contains("batch")) {
                    profile.put("batch", val);
                } else if (label.contains("mobile")) {
                    profile.put("mobile", val);
                }
            }

            String firstCell = cells.get(0);
            if (firstCell.matches("^[A-Z0-9]{6,12}$") && cells.size() >= 6) {
                try {
                    JSObject course = new JSObject();
                    course.put("code", firstCell);
                    course.put("title", cells.get(1));
                    course.put("category", "Theory");
                    course.put("slot", "");
                    int conducted = Integer.parseInt(cells.get(2));
                    int present = Integer.parseInt(cells.get(3));
                    int absent = Integer.parseInt(cells.get(4));
                    double percent = Double.parseDouble(cells.get(5));
                    course.put("conducted", conducted);
                    course.put("present", present);
                    course.put("absent", absent);
                    course.put("percent", percent);
                    course.put("isPortal", true);
                    courses.put(course);
                } catch (NumberFormatException ignored) {}
            } else if (firstCell.matches("^[A-Za-z]{3}-\\d{4}$") && cells.size() >= 3) {
                try {
                    JSObject m = new JSObject();
                    m.put("month", firstCell);
                    m.put("present", Integer.parseInt(cells.get(1)));
                    m.put("absent", Integer.parseInt(cells.get(2)));
                    monthly.put(m);
                } catch (NumberFormatException ignored) {}
            }
        }

        if (!profile.has("name") || profile.optString("name").isEmpty()) {
            try {
                Request pReq = new Request.Builder()
                        .url("https://sp.srmist.edu.in/srmiststudentportal/students/report/studentPersonalDetails.jsp")
                        .header("User-Agent", USER_AGENT)
                        .header("Referer", LOGIN_URL)
                        .build();
                try (Response pResp = httpClient.newCall(pReq).execute()) {
                    if (pResp.isSuccessful() && pResp.body() != null) {
                        String pHtml = pResp.body().string();
                        Matcher pTrMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(pHtml);
                        while (pTrMatcher.find()) {
                            Matcher pTdMatcher = Pattern.compile("<(?:td|th)[^>]*>([\\s\\S]*?)</(?:td|th)>", Pattern.CASE_INSENSITIVE).matcher(pTrMatcher.group(1));
                            List<String> pCells = new ArrayList<>();
                            while (pTdMatcher.find()) {
                                pCells.add(pTdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                            }
                            if (pCells.size() >= 2) {
                                String label = pCells.get(0).toLowerCase();
                                String val = pCells.get(1);
                                if (label.contains("student name") || label.equals("name")) {
                                    profile.put("name", val);
                                } else if (label.contains("register no") || label.contains("registration no") || label.contains("reg no")) {
                                    profile.put("regNo", val);
                                } else if (label.contains("institution") || label.contains("department")) {
                                    profile.put("dept", val);
                                } else if (label.contains("program")) {
                                    profile.put("program", val);
                                } else if (label.contains("semester")) {
                                    profile.put("semester", val);
                                } else if (label.contains("section")) {
                                    profile.put("section", val);
                                } else if (label.contains("batch")) {
                                    profile.put("batch", val);
                                } else if (label.contains("mobile")) {
                                    profile.put("mobile", val);
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    private JSObject fetchPortalTimetableInternal() {
        JSObject result = new JSObject();
        JSObject schedule = new JSObject();
        JSObject coursesMap = new JSObject();
        result.put("schedule", schedule);
        result.put("courses", coursesMap);

        try {
            FormBody form = new FormBody.Builder()
                    .add("iden", "10")
                    .add("filter", "")
                    .add("hdnFormDetails", "1")
                    .add("csrfPreventionSalt", "")
                    .build();

            Request req = new Request.Builder()
                    .url("https://sp.srmist.edu.in/srmiststudentportal/students/report/studentTimeTableDetails.jsp")
                    .header("User-Agent", USER_AGENT)
                    .header("Referer", LOGIN_URL)
                    .post(form)
                    .build();

            String html;
            try (Response resp = httpClient.newCall(req).execute()) {
                if (!resp.isSuccessful()) return result;
                html = resp.body() != null ? resp.body().string() : "";
            }

            Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
            List<List<String>> allRows = new ArrayList<>();
            while (trMatcher.find()) {
                Matcher tdMatcher = Pattern.compile("<(?:td|th)[^>]*>([\\s\\S]*?)</(?:td|th)>", Pattern.CASE_INSENSITIVE).matcher(trMatcher.group(1));
                List<String> cells = new ArrayList<>();
                while (tdMatcher.find()) {
                    cells.add(tdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                }
                if (!cells.isEmpty()) {
                    allRows.add(cells);
                }
            }

            for (List<String> c : allRows) {
                if (c.size() >= 5 && c.get(0).matches("^[A-Z0-9]{6,12}$")) {
                    String code = c.get(0);
                    String name = c.get(1);
                    String credits = c.get(2);
                    String slot = c.get(3);
                    String faculty = c.size() > 4 ? c.get(4) : "TBA";
                    String room = c.size() > 7 ? c.get(7) : "TBA";
                    String kind = (name.toLowerCase().contains("lab") || name.toLowerCase().contains("practical") || slot.toUpperCase().startsWith("P")) ? "Practical" : "Theory";

                    JSObject course = new JSObject();
                    course.put("code", code);
                    course.put("name", name);
                    course.put("title", name);
                    course.put("credits", credits);
                    course.put("slot", slot);
                    course.put("faculty", faculty.isEmpty() ? "TBA" : faculty);
                    course.put("room", room.isEmpty() ? "TBA" : room);
                    course.put("kind", kind);
                    coursesMap.put(code, course);
                }
            }

            List<String> times = new ArrayList<>();
            Pattern timePattern = Pattern.compile("(\\d{1,2}:\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})");
            for (List<String> row : allRows) {
                boolean hasTime = false;
                List<String> rowTimes = new ArrayList<>();
                for (String cell : row) {
                    Matcher tm = timePattern.matcher(cell);
                    if (tm.find()) {
                        hasTime = true;
                        rowTimes.add(tm.group(1) + " - " + tm.group(2));
                    }
                }
                if (hasTime && rowTimes.size() >= 3) {
                    times = rowTimes;
                    break;
                }
            }

            Pattern dayPattern = Pattern.compile("(?i)Day\\s*(\\d+)");
            for (List<String> row : allRows) {
                if (row.isEmpty()) continue;
                Matcher dm = dayPattern.matcher(row.get(0));
                if (dm.find()) {
                    String dayKey = "Day " + dm.group(1);
                    JSObject daySlots = schedule.has(dayKey) ? schedule.getJSObject(dayKey) : new JSObject();
                    schedule.put(dayKey, daySlots);

                    for (int i = 1; i < row.size() && (i - 1) < times.size(); i++) {
                        String cellCode = row.get(i).trim();
                        if (cellCode.isEmpty() || cellCode.equals("-") || cellCode.equals("--")) continue;
                        String time = times.get(i - 1);

                        JSObject slotObj = new JSObject();
                        slotObj.put("code", cellCode);
                        slotObj.put("time", time);

                        if (coursesMap.has(cellCode)) {
                            JSObject matched = coursesMap.getJSObject(cellCode);
                            slotObj.put("title", matched.optString("title", cellCode));
                            slotObj.put("name", matched.optString("name", cellCode));
                            slotObj.put("room", matched.optString("room", "TBA"));
                            slotObj.put("faculty", matched.optString("faculty", "TBA"));
                            slotObj.put("kind", matched.optString("kind", "Theory"));
                            slotObj.put("slot", matched.optString("slot", ""));
                        } else {
                            slotObj.put("title", cellCode);
                            slotObj.put("name", cellCode);
                            slotObj.put("room", "TBA");
                            slotObj.put("faculty", "TBA");
                            slotObj.put("kind", "Theory");
                            slotObj.put("slot", "");
                        }

                        daySlots.put(time, slotObj);
                    }
                }
            }

        } catch (Exception e) {
            Log.e(TAG, "Error fetching portal timetable: " + e.getMessage());
        }
        return result;
    }

    private JSArray fetchPortalMarksInternal() {
        JSArray marks = new JSArray();
        try {
            Request req = new Request.Builder()
                    .url("https://sp.srmist.edu.in/srmiststudentportal/students/report/studentInternalMarkDetails.jsp")
                    .header("User-Agent", USER_AGENT)
                    .header("Referer", LOGIN_URL)
                    .build();

            String html;
            try (Response resp = httpClient.newCall(req).execute()) {
                if (!resp.isSuccessful()) return marks;
                html = resp.body() != null ? resp.body().string() : "";
            }

            Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
            while (trMatcher.find()) {
                Matcher tdMatcher = Pattern.compile("<(?:td|th)[^>]*>([\\s\\S]*?)</(?:td|th)>", Pattern.CASE_INSENSITIVE).matcher(trMatcher.group(1));
                List<String> cells = new ArrayList<>();
                while (tdMatcher.find()) {
                    cells.add(tdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                }
                if (cells.size() >= 3 && cells.get(0).matches("^[A-Z0-9]{6,12}$")) {
                    JSObject m = new JSObject();
                    String code = cells.get(0);
                    String title = cells.get(1);
                    String perf = cells.get(2);
                    m.put("courseCode", code);
                    m.put("course_code", code);
                    m.put("code", code);
                    m.put("course", code);
                    m.put("title", title);
                    m.put("courseTitle", title);
                    m.put("type", "Internal");
                    m.put("kind", "Internal");
                    m.put("raw_type", "Internal");
                    m.put("performance", perf.isEmpty() ? "N/A" : perf);
                    m.put("assessments", new JSArray());

                    if (perf.contains("/")) {
                        String[] parts = perf.split("/");
                        try {
                            double got = Double.parseDouble(parts[0].trim());
                            double max = Double.parseDouble(parts[1].trim());
                            m.put("totalMarkGot", got);
                            m.put("totalMaxMarks", max);
                            m.put("totalGot", got);
                            m.put("totalMax", max);
                            m.put("total_got", got);
                            m.put("total_max", max);
                        } catch (NumberFormatException ignored) {}
                    }
                    marks.put(m);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching portal marks: " + e.getMessage());
        }
        return marks;
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

                JSArray courses = new JSArray();
                JSArray monthly = new JSArray();
                JSObject profile = new JSObject();
                parsePortalAttendanceAndProfile(html, courses, monthly, profile);

                JSObject tt = fetchPortalTimetableInternal();
                JSArray marks = fetchPortalMarksInternal();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("courses", courses);
                ret.put("attendance", courses);
                ret.put("monthly", monthly);
                ret.put("profile", profile);
                ret.put("schedule", tt.getJSObject("schedule"));
                ret.put("timetable", tt.getJSObject("schedule"));
                ret.put("marks", marks);
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

    private String unescapePageSanitizer(String html) {
        if (html == null) return "";
        Matcher sanitizeMatcher = Pattern.compile("pageSanitizer\\.sanitize\\('((?:\\\\.|[^'\\\\])*)'\\)", Pattern.DOTALL).matcher(html);
        if (sanitizeMatcher.find()) {
            return unescapeString(sanitizeMatcher.group(1));
        }
        Matcher zmlMatcher = Pattern.compile("zmlvalue=\"([^\"]+)\"").matcher(html);
        if (zmlMatcher.find()) {
            return zmlMatcher.group(1).replace("\\-", "-").replace("\\/", "/");
        }
        return html;
    }

    private String unescapeString(String raw) {
        StringBuilder sb = new StringBuilder();
        int i = 0;
        int len = raw.length();
        while (i < len) {
            char c = raw.charAt(i);
            if (c != '\\' || i + 1 >= len) {
                sb.append(c);
                i++;
                continue;
            }
            i++;
            char next = raw.charAt(i);
            if (next == 'n') {
                sb.append('\n');
                i++;
            } else if (next == 'r') {
                sb.append('\r');
                i++;
            } else if (next == 't') {
                sb.append('\t');
                i++;
            } else if (next == 'u' && i + 4 < len) {
                String hex = raw.substring(i + 1, i + 5);
                try {
                    sb.append((char) Integer.parseInt(hex, 16));
                    i += 5;
                } catch (NumberFormatException e) {
                    sb.append(next);
                    i++;
                }
            } else {
                sb.append(next);
                i++;
            }
        }
        return sb.toString();
    }

    private JSObject fetchAcademiaFullDataInternal() {
        JSObject data = new JSObject();
        JSArray attendanceList = new JSArray();
        JSArray monthlyList = new JSArray();
        JSArray marksList = new JSArray();
        JSObject profileObj = new JSObject();
        JSObject scheduleObj = new JSObject();
        JSObject coursesMap = new JSObject();

        data.put("attendance", attendanceList);
        data.put("monthly", monthlyList);
        data.put("marks", marksList);
        data.put("profile", profileObj);
        data.put("schedule", scheduleObj);
        data.put("courses", coursesMap);

        try {
            Request attReq = new Request.Builder()
                    .url("https://academia.srmist.edu.in/srm_university/academia-academic-services/page/My_Attendance")
                    .header("User-Agent", "Mozilla/5.0")
                    .build();

            try (Response resp = httpClient.newCall(attReq).execute()) {
                if (resp.isSuccessful() && resp.body() != null) {
                    String raw = resp.body().string();
                    String html = unescapePageSanitizer(raw);

                    Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
                    while (trMatcher.find()) {
                        String rowContent = trMatcher.group(1);
                        Matcher tdMatcher = Pattern.compile("<td[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE).matcher(rowContent);
                        List<String> cells = new ArrayList<>();
                        List<String> rawCells = new ArrayList<>();
                        while (tdMatcher.find()) {
                            String inner = tdMatcher.group(1);
                            rawCells.add(inner);
                            cells.add(inner.replaceAll("<[^>]*>", "").trim());
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
                                    c.put("isPortal", false);
                                    attendanceList.put(c);
                                } catch (Exception ignored) {}
                            }
                        }

                        if (cells.size() >= 3 && rawCells.size() >= 3) {
                            String code = cells.get(0).trim();
                            if (code.matches("^[A-Z0-9]{8,12}$")) {
                                JSObject m = new JSObject();
                                String kind = cells.get(1);
                                m.put("courseCode", code);
                                m.put("course_code", code);
                                m.put("code", code);
                                m.put("course", code);
                                m.put("title", code);
                                m.put("courseTitle", code);
                                m.put("type", kind);
                                m.put("kind", kind);
                                m.put("raw_type", kind);
                                String nestedHtml = rawCells.get(2);

                                JSArray assessments = new JSArray();
                                double totalGot = 0;
                                double totalMax = 0;
                                boolean hasValid = false;

                                Matcher subTdMatcher = Pattern.compile("<td[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE).matcher(nestedHtml);
                                while (subTdMatcher.find()) {
                                    String subText = subTdMatcher.group(1).replaceAll("<[^>]*>", "").trim();
                                    String[] parts = subText.split("\\n");
                                    List<String> cleanParts = new ArrayList<>();
                                    for (String p : parts) {
                                        String pt = p.trim();
                                        if (!pt.isEmpty()) cleanParts.add(pt);
                                    }
                                    if (cleanParts.size() >= 2) {
                                        String header = cleanParts.get(0);
                                        String gotStr = cleanParts.get(1);
                                        String title = header;
                                        String maxStr = "0";
                                        if (header.contains("/")) {
                                            String[] hp = header.split("/");
                                            title = hp[0].trim();
                                            maxStr = hp[1].trim();
                                        }

                                        JSObject ass = new JSObject();
                                        ass.put("title", title);
                                        ass.put("marks", gotStr);
                                        ass.put("total", maxStr);
                                        try {
                                            ass.put("got", Double.parseDouble(gotStr));
                                            ass.put("max", Double.parseDouble(maxStr));
                                        } catch (Exception ignored) {}
                                        assessments.put(ass);

                                        try {
                                            totalGot += Double.parseDouble(gotStr);
                                            totalMax += Double.parseDouble(maxStr);
                                            hasValid = true;
                                        } catch (NumberFormatException ignored) {}
                                    }
                                }

                                m.put("assessments", assessments);
                                m.put("performance", hasValid ? (totalGot + "/" + totalMax) : "N/A");
                                if (hasValid) {
                                    m.put("totalMarkGot", totalGot);
                                    m.put("totalMaxMarks", totalMax);
                                    m.put("totalGot", totalGot);
                                    m.put("totalMax", totalMax);
                                    m.put("total_got", totalGot);
                                    m.put("total_max", totalMax);
                                }
                                marksList.put(m);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching academia attendance page: " + e.getMessage());
        }

        try {
            Request ttReq = new Request.Builder()
                    .url("https://academia.srmist.edu.in/srm_university/academia-academic-services/page/My_Time_Table_2023_24")
                    .header("User-Agent", "Mozilla/5.0")
                    .build();

            try (Response resp = httpClient.newCall(ttReq).execute()) {
                if (resp.isSuccessful() && resp.body() != null) {
                    String raw = resp.body().string();
                    String html = unescapePageSanitizer(raw);

                    Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(html);
                    while (trMatcher.find()) {
                        Matcher tdMatcher = Pattern.compile("<td[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE).matcher(trMatcher.group(1));
                        List<String> cells = new ArrayList<>();
                        while (tdMatcher.find()) {
                            cells.add(tdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                        }

                        for (int i = 0; i + 1 < cells.size(); i += 2) {
                            String label = cells.get(i).toLowerCase();
                            String val = cells.get(i + 1);
                            if (label.contains("registration number") || label.contains("register no")) {
                                profileObj.put("regNo", val);
                            } else if (label.contains("student name") || label.equals("name")) {
                                profileObj.put("name", val);
                            } else if (label.contains("department") || label.contains("institution")) {
                                profileObj.put("dept", val);
                            } else if (label.contains("program")) {
                                profileObj.put("program", val);
                            } else if (label.contains("semester")) {
                                profileObj.put("semester", val);
                            } else if (label.contains("batch")) {
                                profileObj.put("batch", val.contains("/") ? val.substring(val.lastIndexOf('/') + 1).trim() : val);
                            }
                        }

                        if (cells.size() >= 10 && cells.get(1).matches("^[A-Z0-9]{6,12}$")) {
                            String code = cells.get(1);
                            String name = cells.get(2);
                            String credits = cells.get(3);
                            String rawType = cells.get(6);
                            String faculty = cells.get(7);
                            String slot = cells.get(8);
                            String room = cells.size() > 9 ? cells.get(9) : "TBA";
                            boolean isLab = slot.toUpperCase().startsWith("P") || slot.toUpperCase().startsWith("L") || faculty.toLowerCase().contains("lab");

                            JSObject c = new JSObject();
                            c.put("code", code);
                            c.put("name", name);
                            c.put("title", name);
                            c.put("credits", credits);
                            c.put("slot", slot);
                            c.put("faculty", faculty);
                            c.put("room", room);
                            c.put("kind", isLab ? "Practical" : "Theory");
                            c.put("type", isLab ? "Practical" : "Theory");
                            c.put("raw_type", rawType);
                            coursesMap.put(slot, c);
                            coursesMap.put(code, c);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching academia profile timetable: " + e.getMessage());
        }

        // 3. Fetch Unified Time Table for batch grid
        try {
            String batch = profileObj.optString("batch", "1").trim();
            String batchSuffix = batch.equals("1") ? "Batch_1" : "batch_2";
            String[] years = {"2025", "2024", "2023_24"};
            String gridHtml = null;

            for (String yr : years) {
                String gridUrl = yr.equals("2023_24")
                        ? "https://academia.srmist.edu.in/srm_university/academia-academic-services/page/Unified_Time_Table_" + yr
                        : "https://academia.srmist.edu.in/srm_university/academia-academic-services/page/Unified_Time_Table_" + yr + "_" + batchSuffix;
                Request gridReq = new Request.Builder()
                        .url(gridUrl)
                        .header("User-Agent", "Mozilla/5.0")
                        .build();

                try (Response resp = httpClient.newCall(gridReq).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        String unescaped = unescapePageSanitizer(resp.body().string());
                        if (unescaped.toLowerCase().contains("day 1") && unescaped.contains(":")) {
                            gridHtml = unescaped;
                            break;
                        }
                    }
                }
            }

            if (gridHtml != null) {
                Matcher trMatcher = Pattern.compile("<tr[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE).matcher(gridHtml);
                List<List<String>> rows = new ArrayList<>();
                while (trMatcher.find()) {
                    Matcher tdMatcher = Pattern.compile("<(?:td|th)[^>]*>([\\s\\S]*?)</(?:td|th)>", Pattern.CASE_INSENSITIVE).matcher(trMatcher.group(1));
                    List<String> cells = new ArrayList<>();
                    while (tdMatcher.find()) {
                        cells.add(tdMatcher.group(1).replaceAll("<[^>]*>", "").trim());
                    }
                    if (!cells.isEmpty()) rows.add(cells);
                }

                List<String> timeHeaders = new ArrayList<>();
                if (!rows.isEmpty()) {
                    for (String c : rows.get(0)) {
                        if (c.contains(":") && !c.toLowerCase().contains("day")) {
                            timeHeaders.add(c);
                        }
                    }
                }

                Pattern dayPattern = Pattern.compile("(?i)Day\\s*(\\d+)");
                for (List<String> row : rows) {
                    if (row.isEmpty()) continue;
                    Matcher dm = dayPattern.matcher(row.get(0));
                    if (dm.find()) {
                        String dayName = "Day " + dm.group(1);
                        JSObject daySlots = scheduleObj.has(dayName) ? scheduleObj.getJSObject(dayName) : new JSObject();
                        scheduleObj.put(dayName, daySlots);

                        for (int i = 1; i < row.size() && (i - 1) < timeHeaders.size(); i++) {
                            String rawSlot = row.get(i).trim();
                            if (rawSlot.isEmpty() || rawSlot.equals("-") || rawSlot.equals("--")) continue;
                            String slotCode = rawSlot.split("/")[0].trim();
                            if (slotCode.isEmpty()) continue;
                            String time = timeHeaders.get(i - 1);

                            JSObject slotObj = new JSObject();
                            slotObj.put("slot", slotCode);
                            slotObj.put("time", time);

                            if (coursesMap.has(slotCode)) {
                                JSObject matched = coursesMap.getJSObject(slotCode);
                                slotObj.put("course", matched.optString("name", slotCode));
                                slotObj.put("courseCode", matched.optString("code", slotCode));
                                slotObj.put("courseTitle", matched.optString("name", slotCode));
                                slotObj.put("name", matched.optString("name", slotCode));
                                slotObj.put("code", matched.optString("code", slotCode));
                                slotObj.put("type", matched.optString("kind", "Theory"));
                                slotObj.put("kind", matched.optString("kind", "Theory"));
                                slotObj.put("raw_type", matched.optString("kind", "Theory"));
                                slotObj.put("room", matched.optString("room", "TBA"));
                                slotObj.put("faculty", matched.optString("faculty", "TBA"));
                                slotObj.put("credits", matched.optString("credits", ""));
                            } else {
                                slotObj.put("course", slotCode);
                                slotObj.put("courseCode", slotCode);
                                slotObj.put("courseTitle", slotCode);
                                slotObj.put("name", slotCode);
                                slotObj.put("code", slotCode);
                                slotObj.put("type", "Theory");
                                slotObj.put("kind", "Theory");
                                slotObj.put("raw_type", "Theory");
                                slotObj.put("room", "TBA");
                                slotObj.put("faculty", "TBA");
                                slotObj.put("credits", "");
                            }
                            daySlots.put(time, slotObj);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching academia unified timetable grid: " + e.getMessage());
        }

        return data;
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

                        JSObject fullData = fetchAcademiaFullDataInternal();

                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        ret.put("isPortal", false);
                        ret.put("attendance", fullData.opt("attendance"));
                        ret.put("courses", fullData.opt("attendance"));
                        ret.put("monthly", fullData.opt("monthly"));
                        ret.put("marks", fullData.opt("marks"));
                        ret.put("schedule", fullData.opt("schedule"));
                        ret.put("timetable", fullData.opt("schedule"));

                        JSObject profile = fullData.getJSObject("profile");
                        if (!profile.has("name") || profile.optString("name").isEmpty()) {
                            profile.put("name", username);
                            profile.put("regNo", username);
                        }
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

    @PluginMethod
    public void getAcademiaAttendance(PluginCall call) {
        new Thread(() -> {
            try {
                JSObject fullData = fetchAcademiaFullDataInternal();
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("attendance", fullData.opt("attendance"));
                ret.put("courses", fullData.opt("attendance"));
                ret.put("monthly", fullData.opt("monthly"));
                ret.put("marks", fullData.opt("marks"));
                ret.put("profile", fullData.getJSObject("profile"));
                ret.put("schedule", fullData.getJSObject("schedule"));
                ret.put("timetable", fullData.getJSObject("schedule"));
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Error fetching academia attendance: " + e.getMessage(), e);
                call.reject("Error fetching academia attendance: " + e.getMessage());
            }
        }).start();
    }
}
