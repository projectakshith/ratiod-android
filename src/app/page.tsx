"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    const hasSession = document.cookie.includes("ratio_session=");
    const isOnboarded = localStorage.getItem("ratiod_onboarded") === "true";
    
    if (hasSession) {
      router.replace(isOnboarded ? "/dashboard" : "/onboarding");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return <div className="h-screen w-full bg-theme-bg" />;
}
