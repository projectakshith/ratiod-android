"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { useThemeUiStyle, useTheme } from "@/context/ThemeContext";
import { useAcademiaData } from "@/hooks/useAcademiaData";
import SettingsPage from "@/components/shared/SettingsPage";
import FeedbackPopup from "@/components/shared/FeedbackPopup";
import CommunityPopup from "@/components/shared/CommunityPopup";
import TimetableFeatureModal from "@/components/shared/TimetableFeatureModal";
import PortalFeatureModal from "@/components/shared/PortalFeatureModal";
import ThemeFeatureModal from "@/components/shared/ThemeFeatureModal";

const BrutalistThemeLayout = dynamic(
  () => import("@/components/themes/brutalist/BrutalistTheme"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

const MinimalistThemeLayout = dynamic(
  () => import("@/components/themes/minimalist/MinimalTheme"),
  { loading: () => <div className="h-full w-full bg-theme-bg" /> }
);

import { AppLayoutContext } from "@/context/AppLayoutContext";

const SettingsOverlay = React.memo(function SettingsOverlay({
  isOpen,
  onClose,
  onLogout,
  profile,
  onUpdateName,
  onOpenHistory,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void | Promise<void>;
  profile: { name: string; regNo: string };
  onUpdateName: (name: string) => void;
  onOpenHistory: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <AnimatePresence>
      {isOpen && (
        <SettingsPage
          onBack={onClose}
          onLogout={onLogout}
          profile={profile}
          onUpdateName={onUpdateName}
          onSelectTheme={(newTheme) => {
            setTheme(newTheme);
            onClose();
          }}
          onOpenHistory={onOpenHistory}
          currentTheme={theme}
        />
      )}
    </AnimatePresence>
  );
});

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { userData, logout, customDisplayName, setCustomDisplayName, isUpdating, setIsUpdateHistoryOpen } = useApp();
  const uiStyle = useThemeUiStyle();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSwipeDisabled, setIsSwipeDisabled] = useState(false);
  const academia = useAcademiaData(userData as any);
  const router = useRouter();
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const openUpdateHistory = useCallback(() => setIsUpdateHistoryOpen(true), [setIsUpdateHistoryOpen]);

  useEffect(() => {
    const hasSession = document.cookie.includes("ratio_session=");
    const isOnboarded = localStorage.getItem("ratiod_onboarded") === "true";
    const isMobile = window.innerWidth < 768;

    if (!hasSession) {
      router.replace("/login");
    } else if (isMobile && !isOnboarded) {
      router.replace("/onboarding");
    }
  }, [router]);

  const handleUpdateName = useCallback((name: string) => {
    setCustomDisplayName(name);
    localStorage.setItem("ratiod_custom_name", name);
  }, [setCustomDisplayName]);

  const sharedProps = useMemo(() => ({
    data: userData as any,
    academia,
    onLogout: logout,
    customDisplayName,
    onUpdateName: handleUpdateName,
    startEntrance: true,
    onOpenSettings: openSettings,
    isUpdating,
    isSwipeDisabled
  }), [userData, logout, customDisplayName, handleUpdateName, isUpdating, isSwipeDisabled, openSettings]);

  const layoutContextValue = useMemo(() => ({
    onOpenSettings: openSettings,
    isSwipeDisabled,
    setIsSwipeDisabled,
  }), [openSettings, isSwipeDisabled]);
  const settingsProfile = useMemo(() => ({
    name: customDisplayName || userData?.profile?.name || "Student",
    regNo: userData?.profile?.regNo || "",
  }), [customDisplayName, userData?.profile?.name, userData?.profile?.regNo]);

  return (
    <AppLayoutContext.Provider value={layoutContextValue}>
      <div className="fixed inset-0 bg-theme-bg overflow-hidden">
        <TimetableFeatureModal />
        <PortalFeatureModal />
        <ThemeFeatureModal />
        <div className="h-full w-full">
          {uiStyle === "brutalist" ? (
            <BrutalistThemeLayout {...sharedProps}>
              {children}
            </BrutalistThemeLayout>
          ) : (
            <MinimalistThemeLayout {...sharedProps}>
              {children}
            </MinimalistThemeLayout>
          )}
        </div>

        <FeedbackPopup />
        <CommunityPopup />

        <SettingsOverlay
          isOpen={isSettingsOpen}
          onClose={closeSettings}
          onLogout={logout}
          profile={settingsProfile}
          onUpdateName={handleUpdateName}
          onOpenHistory={openUpdateHistory}
        />
      </div>
    </AppLayoutContext.Provider>
  );
}
