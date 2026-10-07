"use client";
import React from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { useThemeUiStyle } from "@/context/ThemeContext";
import { useAcademia } from "@/context/AppLayoutContext";

const TimetableMinimalist = dynamic(
  () => import("@/components/themes/minimalist/timetable/Timetable"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);
const TimetableBrutalist = dynamic(
  () => import("@/components/themes/brutalist/timetable/Timetable"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

export default function TimetablePage() {
  const { userData } = useApp();
  const uiStyle = useThemeUiStyle();
  const academia = useAcademia();
  if (uiStyle === "brutalist") {
    return (
      <TimetableBrutalist 
        data={userData as any}
        schedule={academia.effectiveSchedule}
        dayOrder={academia.effectiveDayOrder}
        academia={academia}
      />
    );
  }

  return (
    <TimetableMinimalist 
      data={userData as any}
      academia={academia}
      startEntrance={true}
    />
  );
}
