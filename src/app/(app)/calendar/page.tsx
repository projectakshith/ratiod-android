"use client";
import React from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { useThemeUiStyle } from "@/context/ThemeContext";
import { useAcademia } from "@/context/AppLayoutContext";

const CalendarMinimalist = dynamic(
  () => import("@/components/themes/minimalist/calendar/Calendar"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);
const CalendarBrutalist = dynamic(
  () => import("@/components/themes/brutalist/calendar/Calendar"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

export default function CalendarPage() {
  const { userData } = useApp();
  const uiStyle = useThemeUiStyle();
  const academia = useAcademia();
  if (uiStyle === "brutalist") {
    return (
      <CalendarBrutalist 
        data={userData as any}
        academia={academia}
      />
    );
  }

  return (
    <CalendarMinimalist 
      data={userData as any}
      academia={academia}
    />
  );
}
