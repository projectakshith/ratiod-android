"use client";
import { useEffect, useState } from "react";
import {
  getClassCancellationKey,
  getLegacyClassCancellationKeys,
  getPreviousClassCancellationKey,
  normalizeClassCancellationMap,
} from "@/utils/timetable/classCancellations";
import type { ClassCancellationMap, ClassCancellationRule } from "@/utils/timetable/classCancellations";

const STORAGE_KEY = "ratio_cancelled_classes";

export function useClassCancellations() {
  const [cancelledClasses, setCancelledClasses] = useState<ClassCancellationMap>({});

  useEffect(() => {
    const load = () => {
      try {
        setCancelledClasses(
          normalizeClassCancellationMap(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")),
        );
      } catch {
        setCancelledClasses({});
      }
    };
    load();
    window.addEventListener("class_cancellations_updated", load);
    return () => window.removeEventListener("class_cancellations_updated", load);
  }, []);

  const saveClassCancellation = (slot: any, rule: ClassCancellationRule) => {
    const next = { ...cancelledClasses };
    const key = getClassCancellationKey(slot);
    getLegacyClassCancellationKeys(slot).forEach((legacyKey) => delete next[legacyKey]);
    delete next[getPreviousClassCancellationKey(slot)];
    const dayOrders = [...new Set(rule.dayOrders.filter((day) => day >= 1 && day <= 5))].sort();
    const dates = [...new Set(rule.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    if (dayOrders.length || dates.length) next[key] = { dayOrders, dates };
    else delete next[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setCancelledClasses(next);
    window.dispatchEvent(new Event("class_cancellations_updated"));
  };

  return { cancelledClasses, saveClassCancellation };
}
