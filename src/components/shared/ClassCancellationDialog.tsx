"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getClassCancellationKey } from "@/utils/timetable/classCancellations";
import type { ClassCancellationRule } from "@/utils/timetable/classCancellations";

interface ClassCancellationDialogProps {
  slot: any;
  dayOrder: number;
  allowedDayOrders: number[];
  cancellation: ClassCancellationRule;
  onClose: () => void;
  onSave: (rule: ClassCancellationRule) => void;
}

export default function ClassCancellationDialog({
  slot,
  dayOrder,
  allowedDayOrders,
  cancellation,
  onClose,
  onSave,
}: ClassCancellationDialogProps) {
  const [repeatOnDayOrder, setRepeatOnDayOrder] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>(cancellation.dates);
  const [newDate, setNewDate] = useState("");
  const slotKey = slot ? getClassCancellationKey(slot) : null;
  const allowedDayOrdersKey = allowedDayOrders.join(",");
  const dayOrdersKey = cancellation.dayOrders
    .filter((day) => allowedDayOrders.includes(day))
    .join(",");
  const datesKey = cancellation.dates.join(",");
  const validCancellationDays = dayOrdersKey.split(",").map(Number).filter((day) => day >= 1 && day <= 5);
  const shouldRepeatOnDayOrder = allowedDayOrders.includes(dayOrder) && (
    validCancellationDays.includes(dayOrder) ||
    (validCancellationDays.length === 0 && cancellation.dates.length === 0)
  );

  useEffect(() => {
    setRepeatOnDayOrder(shouldRepeatOnDayOrder);
    setSelectedDates(cancellation.dates);
    setNewDate("");
  }, [slotKey, dayOrder, shouldRepeatOnDayOrder, allowedDayOrdersKey, datesKey]);

  if (!slot) return null;

  const addDate = () => {
    if (newDate && !selectedDates.includes(newDate)) {
      setSelectedDates((dates) => [...dates, newDate].sort());
    }
    setNewDate("");
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-cancellation-title"
        className="w-full max-w-sm rounded-3xl bg-theme-bg border border-theme-border p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 id="class-cancellation-title" className="text-lg font-black uppercase tracking-wide text-theme-text">
              Class cancellation
            </h2>
            <p className="mt-1 text-sm text-theme-muted">
              {slot.name || slot.courseTitle || slot.course || slot.code} · {slot.time}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-2 rounded-full text-theme-muted hover:bg-theme-surface">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-theme-muted mb-4">
          Only day orders that contain this class can be saved. To cancel it on another order, mark its slot there. Add calendar dates for one-off cancellations.
        </p>
        <button
          type="button"
          aria-pressed={repeatOnDayOrder}
          onClick={() => setRepeatOnDayOrder((repeat) => !repeat)}
          className={`mb-6 w-full rounded-xl border px-4 py-3 text-left text-xs font-bold transition-colors ${repeatOnDayOrder ? "bg-theme-emphasis text-theme-bg border-theme-emphasis" : "bg-theme-surface text-theme-muted border-theme-border"}`}
        >
          Day order {dayOrder} · {repeatOnDayOrder ? "Repeats on this order" : "Date only"}
        </button>

        <label htmlFor="class-cancellation-date" className="block text-xs font-bold text-theme-text mb-2">
          Optional calendar date
        </label>
        <div className="flex gap-2 mb-2">
          <input
            id="class-cancellation-date"
            type="date"
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-theme-border bg-theme-surface px-3 py-2 text-sm text-theme-text"
          />
          <button
            type="button"
            onClick={addDate}
            disabled={!newDate}
            className="rounded-xl border border-theme-border px-3 text-xs font-bold text-theme-text disabled:opacity-40"
          >
            Add date
          </button>
        </div>
        {selectedDates.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {selectedDates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDates((dates) => dates.filter((item) => item !== date))}
                aria-label={`Remove cancellation date ${date}`}
                className="inline-flex items-center gap-1 rounded-full bg-theme-surface px-3 py-1.5 text-xs font-bold text-theme-text"
              >
                {date}<X size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-theme-border py-3 text-sm font-bold text-theme-muted">
            Close
          </button>
          <button type="button" onClick={() => {
            const dayOrders = cancellation.dayOrders.filter(
              (day) => allowedDayOrders.includes(day) && day !== dayOrder,
            );
            if (repeatOnDayOrder && allowedDayOrders.includes(dayOrder)) dayOrders.push(dayOrder);
            onSave({ dayOrders: [...new Set(dayOrders)].sort(), dates: selectedDates });
          }} className="flex-1 rounded-xl bg-theme-emphasis py-3 text-sm font-bold text-theme-bg">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
