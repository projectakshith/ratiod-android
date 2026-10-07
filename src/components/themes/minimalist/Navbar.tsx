"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Haptics } from "@/utils/shared/haptics";

export default function Navbar() {
  const pathname = usePathname();
  const tabs = [
    { id: "marks", label: "marks", path: "/marks" },
    { id: "attendance", label: "attnd", path: "/attendance" },
    { id: "home", label: "home", path: "/dashboard" },
    { id: "timetable", label: "time", path: "/timetable" },
    { id: "calendar", label: "cal", path: "/calendar" },
  ];

  return (
    <nav
      className="px-5 pt-4 flex justify-between items-center bg-theme-bg border-t border-theme-border"
      style={{ paddingBottom: "max(1.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))" }}
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            onClick={() => {
              Haptics.light();
            }}
            className={`min-h-9 px-2 flex items-center justify-center text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-300 ${
              isActive ? "text-theme-text" : "text-theme-subtle"
            }`}
            style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
