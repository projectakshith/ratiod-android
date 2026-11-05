"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";

/**
 * Reports the current route to the Android shell (PortalProbe.setRoute) on
 * every navigation so the system back gesture can decide between the in-app
 * predictive animation to /dashboard and the default back-to-home behavior
 * on the dashboard itself. No-ops outside the Android app.
 */
export default function NativeBackSync() {
  const pathname = usePathname();
  const { theme } = useTheme();

  useEffect(() => {
    if (!pathname) return;
    // child effects run before ThemeContext applies data-theme — wait a frame
    // so the first report carries the user's real --theme-bg
    const raf = requestAnimationFrame(() => {
      try {
        const bg = getComputedStyle(document.documentElement)
          .getPropertyValue("--theme-bg")
          .trim();
        const result = (window as any)?.Capacitor?.Plugins?.PortalProbe?.setRoute?.({ path: pathname, bg });
        result?.catch?.(() => {});
      } catch {
        // not running inside Capacitor — nothing to sync
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, theme]);

  return null;
}
