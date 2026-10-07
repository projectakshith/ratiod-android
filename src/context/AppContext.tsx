"use client";
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { EncryptionUtils, runMigration } from "@/utils/shared/Encryption";
import { useRouter } from "next/navigation";
import { AcademiaData } from "@/types";
import { compareData, DataDiff } from "@/utils/shared/diffUtils";
import { isNativeNotifications, scheduleClassReminders, sendNotification } from "@/utils/shared/notifs";
import { fetchWithLoadBalancer } from "@/utils/backendProxy";
import { UpdateHistoryItem } from "@/types";
import { isMeaningfulAcademiaName } from "@/utils/academia/profile";

import { getScheduleStatus } from "@/utils/academia/academiaLogic";
import calendarDataJson from "@/data/calendar_data.json";

interface AppContextType {
  userData: AcademiaData | null;
  setUserData: (data: AcademiaData | null) => void;
  customDisplayName: string;
  setCustomDisplayName: (name: string) => void;
  isUpdating: boolean;
  setIsUpdating: (val: boolean) => void;
  isOffline: boolean;
  isBackendError: boolean;
  setIsBackendError: (val: boolean) => void;
  backendErrorMsg: string | null;
  setBackendErrorMsg: (msg: string | null) => void;
  refreshData: (existingData: any) => Promise<any>;
  performLogin: (creds: any) => Promise<any>;
  performPortalLogin: (creds: any) => Promise<any>;
  loginPromise: Promise<any> | null;
  setLoginPromise: (promise: Promise<any> | null) => void;
  logout: () => Promise<void>;
  latestDiff: DataDiff | null;
  setLatestDiff: (diff: DataDiff | null) => void;
  updateHistory: UpdateHistoryItem[];
  setUpdateHistory: (history: UpdateHistoryItem[]) => void;
  isUpdateHistoryOpen: boolean;
  setIsUpdateHistoryOpen: (open: boolean) => void;
  deferredPrompt: any;
  canInstall: boolean;
  setCanInstall: (val: boolean) => void;
  setDeferredPrompt: (val: any) => void;
  showWelcome: boolean;
  setShowWelcome: (val: boolean) => void;
  profileSeed: string;
  setProfileSeed: (seed: string) => void;
  calendarData: any[];
  portalAuthOpen: boolean;
  setPortalAuthOpen: (open: boolean) => void;
  portalAuthMode: "full" | "captcha_only";
  setPortalAuthMode: (mode: "full" | "captcha_only") => void;
  isCheckingPortal: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<any>(null);
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isBackendError, setIsBackendError] = useState(false);
  const [backendErrorMsg, setBackendErrorMsg] = useState<string | null>(null);
  const [latestDiff, setLatestDiff] = useState<DataDiff | null>(null);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryItem[]>([]);
  const [isUpdateHistoryOpen, setIsUpdateHistoryOpen] = useState(false);
  const [loginPromise, setLoginPromise] = useState<Promise<any> | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState<boolean>(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [profileSeed, setProfileSeed] = useState<string>("");
  const [portalAuthOpen, setPortalAuthOpen] = useState(false);
  const [portalAuthMode, setPortalAuthMode] = useState<"full" | "captcha_only">("full");
  const [isCheckingPortal, setIsCheckingPortal] = useState(false);
  const updateInProgress = React.useRef(false);
  const sessionNotificationsSent = React.useRef<Set<string>>(new Set());
  const classNotificationsSent = React.useRef<Set<string>>(new Set());
  const hasRefreshed = React.useRef(false);
  const hasPrecached = React.useRef(false);
  const router = useRouter();

  const cleanupHistory = (history: UpdateHistoryItem[]) => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setHours(0, 0, 0, 0);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 1);
    
    return history.filter(item => item.timestamp >= twoDaysAgo.getTime());
  };

  useEffect(() => {
    const savedHistory = localStorage.getItem("ratio_update_history");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        const cleaned = cleanupHistory(parsed);
        setUpdateHistory(cleaned);
        localStorage.setItem("ratio_update_history", JSON.stringify(cleaned));
      } catch (e) {
        setUpdateHistory([]);
      }
    }
  }, []);

  useEffect(() => {
    if (isNativeNotifications()) {
      const syncNativeReminders = () => {
        void scheduleClassReminders(userData?.schedule, calendarDataJson as any[]);
      };
      syncNativeReminders();
      const onVisibility = () => {
        if (document.visibilityState === "visible") syncNativeReminders();
      };
      window.addEventListener("ratio_notifications_changed", syncNativeReminders);
      window.addEventListener("custom_classes_updated", syncNativeReminders);
      document.addEventListener("visibilitychange", onVisibility);
      const rollingRefresh = window.setInterval(syncNativeReminders, 6 * 60 * 60 * 1000);
      return () => {
        window.removeEventListener("ratio_notifications_changed", syncNativeReminders);
        window.removeEventListener("custom_classes_updated", syncNativeReminders);
        document.removeEventListener("visibilitychange", onVisibility);
        window.clearInterval(rollingRefresh);
      };
    }
    if (!userData?.schedule) return;

    const checkClassNotifications = () => {
      const now = new Date();
      const calendar = calendarDataJson as any[];
      const todayEntry = calendar.find((item) => {
        const d = new Date(item.date);
        return (
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      });
      const effectiveDayOrder = (todayEntry?.order ?? userData?.dayOrder) as string | undefined;

      if (!effectiveDayOrder || !["1", "2", "3", "4", "5"].includes(effectiveDayOrder)) {
        return;
      }

      const status = getScheduleStatus(userData.schedule, effectiveDayOrder);
      if (!status.nextClass) return;

      const currentMins = now.getHours() * 60 + now.getMinutes();
      const diff = ((status.nextClass as any).startMinutes || 0) - currentMins;
      const nextClassName = (status.nextClass as any).course || "Class";
      const nextStart = (status.nextClass as any).startMinutes || 0;
      const dayMarker = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${nextStart}`;
      const marker15 = `${dayMarker}-${nextClassName}-15`;
      const marker5 = `${dayMarker}-${nextClassName}-5`;

      if (diff <= 15 && diff > 5 && !classNotificationsSent.current.has(marker15)) {
        sendNotification(`Next: ${nextClassName}`, `⏳ Starts in ${diff} min`, nextClassName);
        classNotificationsSent.current.add(marker15);
      } else if (diff <= 5 && diff >= 0 && !classNotificationsSent.current.has(marker5)) {
        sendNotification(
          `Next: ${nextClassName}`,
          `📍 ${(status.nextClass as any).room || "No Room"} • ⏳ Starts in ${diff} min`,
          nextClassName
        );
        classNotificationsSent.current.add(marker5);
      }
    };

    checkClassNotifications();
    const interval = setInterval(checkClassNotifications, 60000);
    return () => clearInterval(interval);
  }, [userData]);

  useEffect(() => {
    if (typeof window !== "undefined" && "caches" in window && !hasPrecached.current) {
      hasPrecached.current = true;
      const coreRoutes = ["/dashboard", "/attendance", "/marks", "/timetable", "/calendar"];
      coreRoutes.forEach(route => {
        router.prefetch(route);
      });
    }
  }, [router]);

  const calendarData = useMemo(() => {
    return (calendarDataJson as any[]).map(item => ({
      ...item,
      date: new Date(item.date),
      isHoliday: item.dayOrder === "Holiday" || item.dayOrder === "Sunday"
    }));
  }, []);

  const logout = useCallback(async () => {
    await EncryptionUtils.flushAllStorage();
    sessionNotificationsSent.current.clear();
    setUserData(null);
    router.replace("/login");
  }, [router]);

  const checkConnectivity = useCallback(async (err: any) => {
    if (err?.name !== "AbortError" && err?.message !== "Failed to fetch") return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      await fetch("https://1.1.1.1", { method: "HEAD", mode: "no-cors", signal: controller.signal });
      clearTimeout(timeoutId);
      setIsBackendError(true);
    } catch {
      setIsOffline(true);
    }
  }, []);

  const performLogin = useCallback(async (creds: any) => {
    setIsBackendError(false);
    setBackendErrorMsg(null);
    const promise = (async () => {
      try {
        const response = await fetchWithLoadBalancer("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creds),
        });

        if (response.status === 503 || response.status === 429 || response.status === 502 || response.status === 504) {
          setIsBackendError(true);
          try {
            const data = await response.json();
            if (data.detail) setBackendErrorMsg(data.detail);
          } catch {}
          throw new Error("Backend error");
        }
        
        const data = await response.json();
        if (!response.ok || !data.success) {
          if (typeof data.detail === "object" && data.detail !== null) {
            throw data.detail;
          }
          throw new Error(data.detail || "Login failed");
        }

        if (data.cookies) {
          await EncryptionUtils.saveEncrypted("academia_cookies", data.cookies);
          delete data.cookies;
        }

        await EncryptionUtils.saveEncrypted("ratio_credentials", {
          username: creds.username,
          password: creds.password,
        });

        let previous: any = {};
        try { previous = JSON.parse(localStorage.getItem("ratio_data") || "{}"); } catch {}
        const parsedName = String(data.profile?.name || "").trim();
        const profileReady = data.profile && data.profileParsed === true &&
          isMeaningfulAcademiaName(parsedName, data.profile?.regNo, creds.username);
        const previousProfileReady = isMeaningfulAcademiaName(
          previous.profile?.name,
          previous.profile?.regNo,
          creds.username,
        );
        const merged: any = {
          ...previous,
          ...data,
          attendance: data.attendance?.length ? data.attendance : previous.attendance || [],
          marks: data.marks?.length ? data.marks : previous.marks || [],
          profile: profileReady
            ? data.profile
            : previousProfileReady
              ? previous.profile
              : { ...(data.profile || {}), name: "Student" },
          schedule: Object.keys(data.schedule || {}).length ? data.schedule : previous.schedule || {},
          courses: Object.keys(data.courses || {}).length ? data.courses : previous.courses || {},
          isPortal: Boolean(previous.isPortal),
        };
        delete merged.profileParsed;
        merged.timetable = merged.schedule;
        EncryptionUtils.setSessionCookie();
        setUserData(merged);
        localStorage.setItem("ratio_data", JSON.stringify(merged));
        return merged;
      } catch (err: any) {
        if (err.message === 'Backend error') {
          setIsBackendError(true);
        } else {
          await checkConnectivity(err);
        }
        throw err;
      }
    })();

    setLoginPromise(promise);
    return promise;
  }, [checkConnectivity]);

  const performPortalLogin = useCallback(async (creds: any) => {
    setIsBackendError(false);
    setBackendErrorMsg(null);
    const promise = (async () => {
      try {
        let digest = creds.cdigest;
        if (!digest && creds.captcha) {
          const capRes = await fetchWithLoadBalancer("/portal/captcha", { method: "POST" });
          const capData = await capRes.json().catch(() => ({}));
          if (!capRes.ok || !capData.session) {
            throw new Error(capData.detail || "Failed to load portal security check");
          }
          digest = capData.session;
        }

        const response = await fetchWithLoadBalancer("/portal/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: creds.username,
            password: creds.password,
            captcha: creds.captcha || undefined,
            cdigest: digest,
            loginFormFields: creds.loginFormFields,
            domainFieldName: creds.domainFieldName,
            captchaFieldName: creds.captchaFieldName,
            randomDelimiter: creds.randomDelimiter,
          }),
        });

        if (response.status === 503 || response.status === 429 || response.status === 502 || response.status === 504) {
          setIsBackendError(true);
          try {
            const data = await response.json();
            if (data.detail) setBackendErrorMsg(data.detail);
          } catch {}
          throw new Error("Backend error");
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          const detail = data.detail;
          if (typeof detail === "object" && detail !== null) {
            if (detail.type === "WRONG_CAPTCHA" || detail.type === "CAPTCHA_REQUIRED") {
              const freshImage = detail.captcha_image || detail.image;
              const freshDigest = detail.cdigest || detail.session;
              if (freshImage && freshDigest) {
                throw {
                  type: "CAPTCHA_REQUIRED",
                  image: freshImage,
                  cdigest: freshDigest,
                  loginFormFields: detail.loginFormFields,
                  domainFieldName: detail.domainFieldName,
                  captchaFieldName: detail.captchaFieldName,
                  randomDelimiter: detail.randomDelimiter,
                  ocrStatus: detail.ocrStatus,
                  message: detail.message || "Invalid captcha. Please enter the new one.",
                };
              }
              const freshCapRes = await fetchWithLoadBalancer("/portal/captcha", { method: "POST" });
              const freshCapData = await freshCapRes.json().catch(() => ({}));
              throw {
                type: "CAPTCHA_REQUIRED",
                image: freshCapData.captcha_image || freshCapData.image,
                cdigest: freshCapData.session,
                loginFormFields: freshCapData.loginFormFields,
                domainFieldName: freshCapData.domainFieldName,
                captchaFieldName: freshCapData.captchaFieldName,
                randomDelimiter: freshCapData.randomDelimiter,
                message: detail.message || "Invalid captcha. Please enter the new one.",
              };
            }
            throw detail;
          }
          const isWrongCaptcha = typeof detail === "string" && (detail.toLowerCase().includes("captcha") || detail === "wrong captcha, try the new one");
          if (isWrongCaptcha) {
            const freshCapRes = await fetchWithLoadBalancer("/portal/captcha", { method: "POST" });
            const freshCapData = await freshCapRes.json().catch(() => ({}));
            throw {
              type: "CAPTCHA_REQUIRED",
              image: freshCapData.captcha_image || freshCapData.image,
              cdigest: freshCapData.session,
              message: "Invalid captcha. Please enter the security check characters.",
            };
          }
          throw new Error(typeof detail === "string" ? detail : "Login failed");
        }

        if (data.cookies) {
          await EncryptionUtils.saveEncrypted("portal_cookies", data.cookies);
          delete data.cookies;
        }

        await EncryptionUtils.saveEncrypted("portal_credentials", {
          username: creds.username,
          password: creds.password,
        });

        EncryptionUtils.setSessionCookie();
        data.isPortal = true;
        let previous: any = {};
        try { previous = JSON.parse(localStorage.getItem("ratio_data") || "{}"); } catch {}
        const merged: any = {
          ...previous,
          ...data,
          profile: previous.profile && Object.keys(previous.profile).length ? previous.profile : data.profile || {},
          schedule: Object.keys(previous.schedule || {}).length ? previous.schedule : data.schedule || {},
          courses: Object.keys(previous.courses || {}).length ? previous.courses : data.courses || {},
        };
        merged.timetable = merged.schedule;
        setUserData(merged);
        localStorage.setItem("ratio_data", JSON.stringify(merged));
        return merged;
      } catch (err: any) {
        if (err.message === 'Backend error') {
          setIsBackendError(true);
        } else {
          await checkConnectivity(err);
        }
        throw err;
      }
    })();

    setLoginPromise(promise);
    return promise;
  }, [checkConnectivity]);

  const refreshData = useCallback(async (existingData: any) => {
    if (updateInProgress.current) return existingData;
    updateInProgress.current = true;
    setIsUpdating(true);
    setIsBackendError(false);
    setBackendErrorMsg(null);

    const reportError = (msg: string) => {
      setIsBackendError(true);
      setBackendErrorMsg(msg);
    };

    try {
      const [portalCookies, portalCreds, academiaCreds] = (await Promise.all([
        EncryptionUtils.loadDecrypted("portal_cookies"),
        EncryptionUtils.loadDecrypted("portal_credentials"),
        EncryptionUtils.loadDecrypted("ratio_credentials"),
      ])) as any[];

      const hasPortal = !!(portalCookies || portalCreds?.password);
      const hasAcademiaCourses = Object.keys(existingData?.courses || {}).length > 0;
      const needsAcademiaCourses = !hasAcademiaCourses && !!academiaCreds?.username && !!academiaCreds?.password;
      if (!hasPortal && !needsAcademiaCourses) return existingData;

      const refreshPortal = async () => {
        setIsCheckingPortal(true);
        try {
          const res = await fetchWithLoadBalancer("/portal/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cookies: portalCookies,
              username: portalCreds?.username,
              password: portalCreds?.password,
            }),
          }, 60000);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success && data.attendance?.length) {
            if (data.cookies) {
              await EncryptionUtils.saveEncrypted("portal_cookies", data.cookies);
              delete data.cookies;
            }
            return data;
          }
          if (res.status === 401 && portalCreds?.password) {
            setPortalAuthMode("captcha_only");
            setPortalAuthOpen(true);
          }
          reportError(typeof data?.detail === "string" ? data.detail : "student portal didn't sync");
          return null;
        } catch (err) {
          await checkConnectivity(err);
          reportError("student portal timed out");
          return null;
        } finally {
          setIsCheckingPortal(false);
        }
      };

      const refreshAcademiaCourses = async () => {
        try {
          const res = await fetchWithLoadBalancer("/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: academiaCreds.username,
              password: academiaCreds.password,
            }),
          }, 60000);
          const data = await res.json().catch(() => ({}));
          return res.ok && data?.success && Object.keys(data.courses || {}).length ? data : null;
        } catch {
          return null;
        }
      };

      const [portalData, academiaData] = await Promise.all([
        hasPortal ? refreshPortal() : null,
        needsAcademiaCourses ? refreshAcademiaCourses() : null,
      ]);
      if (!portalData && !academiaData) return existingData;

      const fresh: Record<string, any> = {};
      if (portalData) {
        fresh.attendance = portalData.attendance;
        fresh.isPortal = true;
        for (const key of ["monthly", "marks"]) {
          if (portalData[key] && (!Array.isArray(portalData[key]) || portalData[key].length > 0)) {
            fresh[key] = portalData[key];
          }
        }
      }
      if (academiaData?.courses && Object.keys(academiaData.courses).length) {
        fresh.courses = academiaData.courses;
      }

      EncryptionUtils.setSessionCookie();

      const mergedData = { ...existingData, ...fresh };
      const hasOldData = (existingData?.attendance?.length > 0) || (existingData?.marks?.length > 0);
      const diff = hasOldData ? compareData(existingData, mergedData) : null;

      if (diff) {
        setLatestDiff(diff);
        const timestamp = Date.now();
        const newHistoryItem: UpdateHistoryItem = {
          id: `update-${timestamp}`,
          timestamp,
          diff,
        };

        setUpdateHistory(prev => {
          const updated = cleanupHistory([newHistoryItem, ...prev]);
          localStorage.setItem("ratio_update_history", JSON.stringify(updated));
          return updated;
        });

        const changedCourseIds = new Set([
          ...diff.attendanceChanges.map(a => a.course),
          ...diff.newMarks.map(m => m.course)
        ]);

        mergedData.attendance = mergedData.attendance?.map((a: any) => ({
          ...a,
          updatedAt: changedCourseIds.has(a.title || a.course || a.code) ? Date.now() : (a.updatedAt || 0)
        }));

        mergedData.marks = mergedData.marks?.map((m: any) => ({
          ...m,
          updatedAt: changedCourseIds.has(m.courseTitle || m.courseCode) ? Date.now() : (m.updatedAt || 0)
        }));
      }

      setUserData(mergedData);
      localStorage.setItem("ratio_data", JSON.stringify(mergedData));
      return mergedData;
    } finally {
      setIsUpdating(false);
      updateInProgress.current = false;
      window.dispatchEvent(new Event("ratio_refresh_completed"));
    }
  }, [checkConnectivity]);

  useEffect(() => {
    const cachedData = localStorage.getItem("ratio_data");
    const cachedName = localStorage.getItem("ratiod_custom_name");
    let cachedSeed = localStorage.getItem("ratio_profile_seed");

    if (cachedName) setCustomDisplayName(cachedName);

    const onboarded = localStorage.getItem("ratiod_onboarded") === "true";
    if (onboarded) {
      document.cookie = "ratio_onboarded=true; path=/; max-age=31536000; SameSite=Lax";
    }

    let parsed: any = null;
    if (cachedData) {
      try {
        parsed = JSON.parse(cachedData);
        const oldName = String(parsed.profile?.name || "").trim();
        if (parsed.profile && !isMeaningfulAcademiaName(oldName, parsed.profile?.regNo)) {
          parsed = { ...parsed, profile: { ...parsed.profile, name: "Student" } };
          localStorage.setItem("ratio_data", JSON.stringify(parsed));
          if (cachedSeed?.trim().toLowerCase() === oldName.toLowerCase()) {
            localStorage.removeItem("ratio_profile_seed");
            cachedSeed = null;
          }
        }
        setUserData(parsed);

        void runMigration().catch(() => undefined).finally(() => {
          if (!hasRefreshed.current) {
            hasRefreshed.current = true;
            void refreshData(parsed);
          }
        });
      } catch {
      }
    }

    if (cachedSeed) {
      setProfileSeed(cachedSeed);
    } else if (parsed && parsed.profile && parsed.profile.name) {
      const initialSeed = parsed.profile.name;
      setProfileSeed(initialSeed);
      localStorage.setItem("ratio_profile_seed", initialSeed);
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOffline(!navigator.onLine);

    const installPromptHandler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", installPromptHandler);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", installPromptHandler);
    };
  }, []);

  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    let lastRefreshAt = 0;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;

      const now = Date.now();
      if (now - lastRefreshAt < 3000) return;
      lastRefreshAt = now;

      let savedData: any;
      try {
        savedData = JSON.parse(localStorage.getItem("ratio_data") || "null");
      } catch {
        return;
      }
      if (!savedData) return;

      void (async () => {
        const [portalCookies, portalCredentials] = await Promise.all([
          EncryptionUtils.loadDecrypted("portal_cookies"),
          EncryptionUtils.loadDecrypted("portal_credentials"),
        ]);
        if (portalCookies || (portalCredentials as any)?.password) {
          await refreshData(savedData);
        }
      })().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshData]);

  useEffect(() => {
    if (userData?.profile?.name && !localStorage.getItem("ratio_profile_seed")) {
      const initialSeed = userData.profile.name;
      setProfileSeed(initialSeed);
      localStorage.setItem("ratio_profile_seed", initialSeed);
    }
  }, [userData]);

  useEffect(() => {
    if (!latestDiff) return;

    latestDiff.attendanceChanges.forEach((change) => {
      const notifId = `att-${change.course}-${change.newMargin}-${change.newPercent}`;
      if (sessionNotificationsSent.current.has(notifId)) return;

      const direction = change.diff > 0 ? "Increased" : "Decreased";
      const icon = change.diff > 0 ? "📈" : "📉";
      const label = change.newPercent >= 75 ? "Margin" : "Required";
      
      sendNotification(
        `Attendance ${direction}`,
        `${icon} ${change.course}: ${label} ${change.oldMargin} -> ${change.newMargin}`,
        `attendance-${change.course}`,
      );
      sessionNotificationsSent.current.add(notifId);
    });

    latestDiff.newMarks.forEach((mark) => {
      const notifId = `mark-${mark.course}-${mark.test}-${mark.score}`;
      if (sessionNotificationsSent.current.has(notifId)) return;

      sendNotification(
        `New Marks: ${mark.course}`,
        `📝 ${mark.test}: ${mark.score}/${mark.max} scored!`,
        `marks-${mark.course}-${mark.test}`,
      );
      sessionNotificationsSent.current.add(notifId);
    });

  }, [latestDiff]);

  const value = useMemo(() => ({
    userData,
    setUserData,
    customDisplayName,
    setCustomDisplayName,
    isUpdating,
    setIsUpdating,
    isOffline,
    isBackendError,
    setIsBackendError,
    backendErrorMsg,
    setBackendErrorMsg,
    refreshData,
    performLogin,
    performPortalLogin,
    loginPromise,
    setLoginPromise,
    logout,
    latestDiff,
    setLatestDiff,
    updateHistory,
    setUpdateHistory,
    isUpdateHistoryOpen,
    setIsUpdateHistoryOpen,
    deferredPrompt,
    canInstall,
    setCanInstall,
    setDeferredPrompt,
    showWelcome,
    setShowWelcome,
    profileSeed,
    setProfileSeed,
    calendarData,
    portalAuthOpen,
    setPortalAuthOpen,
    portalAuthMode,
    setPortalAuthMode,
    isCheckingPortal,
  }), [userData, customDisplayName, isUpdating, isOffline, isBackendError, backendErrorMsg, refreshData, performLogin, performPortalLogin, loginPromise, logout, latestDiff, updateHistory, isUpdateHistoryOpen, deferredPrompt, canInstall, showWelcome, profileSeed, calendarData, portalAuthOpen, portalAuthMode, isCheckingPortal]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
