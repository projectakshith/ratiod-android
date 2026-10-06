import { getAcronym } from "@/utils/dashboard/timetableLogic";

export interface ClassCancellationRule {
  dayOrders: number[];
  dates: string[];
}

export type ClassCancellationMap = Record<string, ClassCancellationRule>;

export const EMPTY_CANCELLATION_RULE: ClassCancellationRule = {
  dayOrders: [],
  dates: [],
};

export const getClassCancellationKey = (slot: any, timeRange?: string) => {
  const course = String(
    slot?.courseCode || slot?.code || slot?.course || slot?.name || slot?.id || "unknown",
  ).split("-")[0].trim().toLowerCase();
  const classSlot = String(slot?.slot || "").trim().toUpperCase().replace(/\s+/g, "");
  const occurrence = classSlot || String(timeRange || slot?.time || slot?.id || "unknown").trim();
  return `${course}|${occurrence}`;
};

export const getPreviousClassCancellationKey = (slot: any) => {
  const course = String(slot?.courseCode || slot?.code || slot?.course || slot?.name || slot?.id || "unknown")
    .split("-")[0]
    .trim()
    .toLowerCase();
  const classSlot = String(slot?.slot || "").trim().toUpperCase().replace(/\s+/g, "");
  return `${course}|${classSlot || String(slot?.time || slot?.id || "unknown").trim()}`;
};

export const getLegacyClassCancellationKeys = (slot: any, timeRange?: string) => {
  const time = String(timeRange || slot?.time || slot?.id || "unknown").trim();
  const titleAcronyms = [slot?.courseTitle, slot?.title, slot?.name, slot?.course]
    .filter((title) => typeof title === "string" && title.trim())
    .map(getAcronym);
  return [...new Set([slot?.code, slot?.courseCode, slot?.course, slot?.name, slot?.id, ...titleAcronyms]
    .filter((course) => course != null && String(course).trim())
    .map((course) => `${String(course).trim()}|${time}`))];
};

const uniqueDayOrders = (values: unknown) =>
  Array.isArray(values)
    ? [...new Set(values.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 5))].sort()
    : [];

const uniqueDates = (values: unknown) =>
  Array.isArray(values)
    ? [...new Set(values.filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
    : [];

export const normalizeClassCancellationRule = (value: any): ClassCancellationRule => {
  if (Array.isArray(value)) {
    return { dayOrders: uniqueDayOrders(value), dates: [] };
  }
  return {
    dayOrders: uniqueDayOrders(value?.dayOrders),
    dates: uniqueDates(value?.dates),
  };
};

export const normalizeClassCancellationMap = (value: any): ClassCancellationMap => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, rule]) => [key, normalizeClassCancellationRule(rule)]),
  );
};

export const getClassCancellationRule = (
  cancellations: ClassCancellationMap,
  slot: any,
  timeRange?: string,
) => {
  const currentKey = getClassCancellationKey(slot, timeRange);
  const stored = cancellations[currentKey] ?? getLegacyClassCancellationKeys(slot, timeRange)
    .map((key) => cancellations[key])
    .find(Boolean);
  return normalizeClassCancellationRule(stored);
};

export const hasClassCancellationRule = (
  cancellations: ClassCancellationMap,
  slot: any,
  timeRange?: string,
) => Boolean(
  cancellations[getClassCancellationKey(slot, timeRange)] ??
  getLegacyClassCancellationKeys(slot, timeRange).some((key) => cancellations[key])
);

export const toLocalDateKey = (value?: Date | string | null) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const isClassCancelled = (
  cancellations: ClassCancellationMap,
  slot: any,
  dayOrder?: number | string,
  calendarDate?: Date | string | null,
  timeRange?: string,
) => {
  const rule = getClassCancellationRule(cancellations, slot, timeRange);
  const order = Number(dayOrder);
  const date = toLocalDateKey(calendarDate);
  return (Number.isInteger(order) && rule.dayOrders.includes(order)) || (!!date && rule.dates.includes(date));
};
