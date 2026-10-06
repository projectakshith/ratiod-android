"use client";
import { motion } from "framer-motion";
import { ArrowRight, MapPin, X } from "lucide-react";
import type { CalendarScheduleItem } from "@/utils/timetable/calendarSchedule";

interface CalendarScheduleCardProps {
  date: Date;
  dayOrder: number | string;
  classes: CalendarScheduleItem[];
  variant?: "minimalist" | "brutalist";
  onClose: () => void;
  onOpenTimetable: () => void;
}

export default function CalendarScheduleCard({
  date,
  dayOrder,
  classes,
  variant = "minimalist",
  onClose,
  onOpenTimetable,
}: CalendarScheduleCardProps) {
  const isBrutalist = variant === "brutalist";

  return (
    <motion.section
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.98 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      aria-label={`Classes for ${date.toLocaleDateString("en-IN", { dateStyle: "medium" })}`}
      className={`absolute bottom-[92px] left-4 right-4 z-40 mx-auto max-w-lg overflow-hidden border p-4 shadow-2xl backdrop-blur-xl ${isBrutalist ? "rounded-2xl border-black/10 bg-white/95 text-black" : "rounded-3xl border-theme-border bg-theme-bg/95 text-theme-text"}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${isBrutalist ? "text-black/45" : "text-theme-muted"}`}>
            day order {String(dayOrder).padStart(2, "0")} · {date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
          </p>
          <h2 className="mt-1 text-lg font-black lowercase">class schedule</h2>
        </div>
        <button
          type="button"
          aria-label="Close timetable preview"
          onClick={onClose}
          className={`rounded-full p-2 ${isBrutalist ? "hover:bg-black/5" : "hover:bg-theme-surface"}`}
        >
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[30vh] overflow-y-auto">
        {classes.map((item) => (
          <div key={item.id} className={`flex items-start gap-3 border-t py-2.5 ${isBrutalist ? "border-black/10" : "border-theme-border"}`}>
            <span className={`w-[88px] shrink-0 pt-0.5 text-[11px] font-black ${isBrutalist ? "text-black/55" : "text-theme-muted"}`}>
              {item.time}
            </span>
            <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-bold ${item.cancelled ? "line-through opacity-60" : ""}`}>
                  {item.name}
                </p>
              {item.cancelled && <p className="text-[10px] font-bold uppercase opacity-60">cancelled</p>}
              <p className={`mt-0.5 flex items-center gap-1 text-[10px] font-semibold ${isBrutalist ? "text-black/45" : "text-theme-muted"}`}>
                <><MapPin size={10} /> {item.room}</>
                {item.slot ? ` · ${item.slot}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenTimetable}
        className={`mt-3 flex w-full items-center justify-between rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-transform active:scale-[0.98] ${isBrutalist ? "bg-[#ceff1c] text-black" : "bg-theme-emphasis text-theme-bg"}`}
      >
        timetable <ArrowRight size={15} />
      </button>
    </motion.section>
  );
}
