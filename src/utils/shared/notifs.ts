import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type LocalNotificationSchema } from "@capacitor/local-notifications";
import { parseTimeValues } from "@/utils/academia/academiaLogic";

const NOTIF_PREF_KEY = "ratio_notifs_enabled";
const CLASS_NOTIFICATION_BASE = 710000;
const CLASS_NOTIFICATION_LIMIT = 740000;
const CLASS_CHANNEL_ID = "class-reminders";
const CLASS_HORIZON_DAYS = 7;

export const isNativeNotifications = (): boolean => Capacitor.isNativePlatform();

export const getNotifPreference = (): boolean => {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(NOTIF_PREF_KEY) === "false") return false;
  if (isNativeNotifications()) return localStorage.getItem(NOTIF_PREF_KEY) === "true";
  return "Notification" in window && Notification.permission === "granted";
};

export const setNotifPreference = (enabled: boolean): void => {
  localStorage.setItem(NOTIF_PREF_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new Event("ratio_notifications_changed"));
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  if (isNativeNotifications()) {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === "granted";
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
};

export const requestExactAlarmPermission = async (): Promise<boolean> => {
  if (!isNativeNotifications()) return true;
  const current = await LocalNotifications.checkExactNotificationSetting();
  if (current.exact_alarm === "granted") return true;
  const requested = await LocalNotifications.changeExactNotificationSetting();
  return requested.exact_alarm === "granted";
};

const cancelClassReminders = async (): Promise<void> => {
  const { notifications } = await LocalNotifications.getPending();
  const owned = notifications
    .filter(({ id }) => id >= CLASS_NOTIFICATION_BASE && id < CLASS_NOTIFICATION_LIMIT)
    .map(({ id }) => ({ id }));
  if (owned.length) await LocalNotifications.cancel({ notifications: owned });
};

const parseCalendarDate = (raw: string): Date | null => {
  const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Number(match[3]), month, Number(match[1]));
};

const mergeCustomClasses = (schedule: any): any => {
  const merged = { ...(schedule || {}) };
  try {
    const custom = JSON.parse(localStorage.getItem("ratio_custom_classes") || "{}");
    for (const [dayNumber, classes] of Object.entries(custom) as [string, any[]][]) {
      const dayKey = `Day ${dayNumber}`;
      merged[dayKey] = { ...(merged[dayKey] || {}) };
      for (const slot of classes || []) {
        if (slot?.time) merged[dayKey][slot.time] = slot;
      }
    }
  } catch {
    // Keep the fetched timetable if local custom-class data is malformed.
  }
  return merged;
};

export const scheduleClassReminders = async (schedule: any, calendar: any[]): Promise<void> => {
  if (!isNativeNotifications()) return;
  try {
    await cancelClassReminders();
    if (!getNotifPreference() || !schedule) return;
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") return;

    await LocalNotifications.createChannel({
      id: CLASS_CHANNEL_ID,
      name: "Class reminders",
      description: "Reminders before scheduled classes",
      importance: 4,
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastDay = new Date(today);
    lastDay.setDate(lastDay.getDate() + CLASS_HORIZON_DAYS);
    const fullSchedule = mergeCustomClasses(schedule);
    const notifications: LocalNotificationSchema[] = [];

    for (const item of calendar || []) {
      const day = parseCalendarDate(String(item.date || ""));
      const dayOrder = String(item.order || "");
      if (!day || day < today || day >= lastDay || !/^[1-5]$/.test(dayOrder)) continue;

      const daySlots = Object.entries(fullSchedule[`Day ${dayOrder}`] || {})
        .map(([range, details]: [string, any]) => {
          const startText = String(range).split(" - ")[0];
          return { range, details, startMinutes: parseTimeValues(startText) };
        })
        .filter(({ startMinutes }) => startMinutes > 0)
        .sort((a, b) => a.startMinutes - b.startMinutes);

      daySlots.forEach(({ range, details }, slotIndex) => {
        const course = details?.course || details?.courseTitle || details?.name || "Class";
        const room = details?.room || "No Room";
        [15, 5].forEach((lead, leadIndex) => {
          const at = new Date(day);
          const startMinutes = parseTimeValues(String(range).split(" - ")[0]);
          at.setMinutes(startMinutes - lead);
          if (at.getTime() <= Date.now()) return;
          const dayOffset = Math.round((day.getTime() - today.getTime()) / 86400000);
          const id = CLASS_NOTIFICATION_BASE + dayOffset * 1000 + slotIndex * 2 + leadIndex;
          notifications.push({
            id,
            title: `Next: ${course}`,
            body: lead === 15 ? "⏳ Starts in 15 min" : `📍 ${room} • ⏳ Starts in 5 min`,
            channelId: CLASS_CHANNEL_ID,
            schedule: { at, allowWhileIdle: true },
            extra: { course, range, lead },
          });
        });
      });
    }

    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch {
    // Notification permission, exact-alarm access, and OEM limits are user/device controlled.
  }
};

export const sendNotification = async (
  title: string,
  body: string,
  tag?: string,
): Promise<void> => {
  if (!getNotifPreference()) return;
  try {
    if (isNativeNotifications()) {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") return;
      await LocalNotifications.schedule({
        notifications: [{
          id: 800000 + Math.floor(Math.random() * 100000),
          title,
          body,
          channelId: CLASS_CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
          extra: { tag },
        }],
      });
      return;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const options = {
      body,
      icon: "/icons/icon-192.png",
      vibrate: [200, 100, 200],
      tag: tag || "class-alert",
      renotify: true,
      badge: "/icons/icon-192.png",
    } as any;
    if (registration?.active) await registration.showNotification(title, options);
    else new Notification(title, options);
  } catch {
  }
};
