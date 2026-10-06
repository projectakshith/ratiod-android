import { isClassCancelled } from "@/utils/timetable/classCancellations";
import type { ClassCancellationMap } from "@/utils/timetable/classCancellations";

export interface CalendarScheduleItem {
  id: string;
  name: string;
  room: string;
  slot: string;
  type: string;
  time: string;
  cancelled: boolean;
}

const timeToMinutes = (value: string) => {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 7) hour += 12;
  return hour * 60 + minute;
};

export const getCalendarScheduleItems = (
  schedule: any,
  rawDayOrder: number | string | undefined,
  cancellations: ClassCancellationMap = {},
  calendarDate?: Date,
): CalendarScheduleItem[] => {
  const dayOrder = Number.parseInt(String(rawDayOrder || ""), 10);
  if (!Number.isInteger(dayOrder) || dayOrder < 1 || dayOrder > 5) return [];

  const daySchedule =
    schedule?.[`Day ${dayOrder}`] || schedule?.[`day ${dayOrder}`] || schedule?.[String(dayOrder)] || {};
  const rows = Object.entries(daySchedule)
    .filter(([, slot]) => Boolean(slot && typeof slot === "object" && (slot as any).type !== "break"))
    .map(([timeRange, rawSlot]: [string, any]) => {
      const time = String(rawSlot.time || timeRange);
      const [start = time, end = time] = time.split(/\s+-\s+/);
      return {
        key: `${rawSlot.courseCode || rawSlot.code || rawSlot.course || rawSlot.name || "class"}`.trim().toLowerCase(),
        start,
        end,
        startMinutes: timeToMinutes(start),
        endMinutes: timeToMinutes(end),
        name: rawSlot.courseTitle || rawSlot.name || rawSlot.course || rawSlot.code || "Class",
        room: rawSlot.room || "TBA",
        slot: rawSlot.slot || "",
        type: rawSlot.type || "theory",
        cancelled: isClassCancelled(cancellations, rawSlot, dayOrder, calendarDate, timeRange),
      };
    })
    .sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0));

  const items: (CalendarScheduleItem & {
    courseKey: string;
    endMinutes: number | null;
  })[] = [];

  for (const row of rows) {
    const previous = items[items.length - 1];
    if (
      previous &&
      previous.courseKey === row.key &&
      previous.room === row.room &&
      previous.slot === row.slot &&
      previous.cancelled === row.cancelled &&
      previous.endMinutes !== null &&
      previous.endMinutes === row.startMinutes
    ) {
      previous.time = `${previous.time.split(" - ")[0]} - ${row.end}`;
      previous.endMinutes = row.endMinutes;
      continue;
    }

    items.push({
      id: `${row.key}-${row.start}`,
      name: row.name,
      room: row.room,
      slot: row.slot,
      type: row.type,
      cancelled: row.cancelled,
      time: `${row.start} - ${row.end}`,
      courseKey: row.key,
      endMinutes: row.endMinutes,
    });
  }

  return items.map(({ courseKey: _courseKey, endMinutes: _endMinutes, ...item }) => item);
};
