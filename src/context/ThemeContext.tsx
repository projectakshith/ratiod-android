"use client";
import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { migrateTheme, parseTheme, type UiStyle } from "@/utils/theme/themeUtils";

interface ThemeContextType {
  theme: string;
  setTheme: (theme: string) => void;
  uiStyle: "minimalist" | "brutalist";
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const UiStyleContext = createContext<UiStyle | undefined>(undefined);

function syncThemeToSystem(theme: string) {
  const { isDark } = parseTheme(theme);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--theme-bg")
    .trim();
  if (!bgColor) return;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", bgColor);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<string>("minimalist_minimalist-dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem("ratiod_theme");
      const migrated = migrateTheme(savedRaw);
      setThemeState(migrated);
      const { colorTheme } = parseTheme(migrated);
      document.documentElement.setAttribute("data-theme", colorTheme);
      syncThemeToSystem(migrated);
    } catch {
      document.documentElement.setAttribute("data-theme", "minimalist-dark");
    } finally {
      setMounted(true);
    }
  }, []);

  const setTheme = React.useCallback((newTheme: string) => {
    const migrated = migrateTheme(newTheme);
    setThemeState(migrated);
    const { colorTheme } = parseTheme(migrated);
    document.documentElement.setAttribute("data-theme", colorTheme);
    syncThemeToSystem(migrated);
    try {
      localStorage.setItem("ratiod_theme", migrated);
    } catch {
    }
  }, []);

  const { uiStyle, isDark } = parseTheme(theme);

  const value = useMemo(() => ({
    theme,
    setTheme,
    uiStyle,
    isDark
  }), [theme, setTheme, uiStyle, isDark]);

  const uiStyleValue = useMemo(() => uiStyle, [uiStyle]);

  if (!mounted) return <div className="h-[100dvh] w-full bg-[#111111]" />;

  return (
    <ThemeContext.Provider value={value}>
      <UiStyleContext.Provider value={uiStyleValue}>
        {children}
      </UiStyleContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useThemeUiStyle() {
  const uiStyle = useContext(UiStyleContext);
  if (uiStyle === undefined) throw new Error("useThemeUiStyle must be used within a ThemeProvider");
  return uiStyle;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
