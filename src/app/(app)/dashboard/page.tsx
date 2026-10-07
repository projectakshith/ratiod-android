"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { useThemeUiStyle } from "@/context/ThemeContext";

const DashboardMinimalist = dynamic(
  () => import("@/components/themes/minimalist/dashboard/Dashboard"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);
const DashboardBrutalist = dynamic(
  () => import("@/components/themes/brutalist/dashboard/Dashboard"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

import { useAcademiaData } from "@/hooks/useAcademiaData";
import { useAppLayout } from "@/context/AppLayoutContext";


export default function DashboardPage() {
  const { userData, customDisplayName, isUpdating } = useApp();
  const uiStyle = useThemeUiStyle();
  const { onOpenSettings } = useAppLayout();
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const academia = useAcademiaData(userData as any);
  if (uiStyle === "brutalist") {
    return (
      <DashboardBrutalist 
        onProfileClick={onOpenSettings}
        profile={userData?.profile}
        attendance={userData?.attendance}
        displayName={customDisplayName || userData?.profile?.name}
        timeStatus={academia.timeStatus}
        calendarData={academia.calendarData}
        upcomingAlerts={[]}
        overallAttendance={academia.overallAttendance}
        criticalAttendance={academia.criticalAttendance}
        overallMarks={(academia as any).overallMarks || 0}
        recentMarks={(academia as any).recentMarks || []}
        isRefreshing={isUpdating}
        data={userData}
        academia={academia}
      />
    );
  }

  return (
    <DashboardMinimalist 
      data={userData as any}
      academia={academia}
      onOpenSettings={onOpenSettings}
      isAlertsOpen={isAlertsOpen}
      setIsAlertsOpen={setIsAlertsOpen}
      startEntrance={true}
      isRefreshing={isUpdating}
    />
  );
}
