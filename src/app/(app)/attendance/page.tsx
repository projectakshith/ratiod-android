"use client";
import React from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { useThemeUiStyle } from "@/context/ThemeContext";
import { useAcademia } from "@/context/AppLayoutContext";

const AttendanceMinimalist = dynamic(
  () => import("@/components/themes/minimalist/attendance/Attendance"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);
const AttendanceBrutalist = dynamic(
  () => import("@/components/themes/brutalist/attendance/Attendance"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

export default function AttendancePage() {
  const { userData } = useApp();
  const uiStyle = useThemeUiStyle();
  const academia = useAcademia();
  if (uiStyle === "brutalist") {
    return (
      <AttendanceBrutalist 
        data={userData as any}
        academia={academia}
      />
    );
  }

  return (
    <AttendanceMinimalist 
      data={userData as any}
      academia={academia}
    />
  );
}
