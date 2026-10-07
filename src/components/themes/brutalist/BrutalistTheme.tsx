"use client";
import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { BottomNav } from "./BottomNav";
import { usePathname, useRouter } from "next/navigation";
import { Haptics } from "@/utils/shared/haptics";

interface BrutalistThemeProps {
  children: React.ReactNode;
  isSwipeDisabled?: boolean;
}

function BrutalistTheme({ children, isSwipeDisabled }: BrutalistThemeProps) {
  const [isLoading, setIsLoading] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const paths = ["/marks", "/attendance", "/dashboard", "/timetable", "/calendar"];

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isScrollingVertical = useRef(false);
  const swipeTriggered = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSwipeDisabled) return;
    isScrollingVertical.current = false;
    swipeTriggered.current = false;
    touchStart.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  }, [isSwipeDisabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchStart.current;
    if (isSwipeDisabled || !start || isScrollingVertical.current || swipeTriggered.current) return;

    const touchX = e.targetTouches[0].clientX;
    const touchY = e.targetTouches[0].clientY;

    const dx = Math.abs(touchX - start.x);
    const dy = Math.abs(touchY - start.y);

    if (dy > dx && dy > 10) {
      isScrollingVertical.current = true;
      return;
    }

    if (dx > 70) {
      const currentIndex = paths.indexOf(pathname);
      if (touchX < start.x && currentIndex < paths.length - 1) {
        swipeTriggered.current = true;
        Haptics.heavy();
        router.push(paths[currentIndex + 1]);
      } else if (touchX > start.x && currentIndex > 0) {
        swipeTriggered.current = true;
        Haptics.heavy();
        router.push(paths[currentIndex - 1]);
      }
    }
  }, [pathname, router, isSwipeDisabled]);

  const handleTouchEnd = useCallback(() => {
    touchStart.current = null;
    isScrollingVertical.current = false;
  }, []);

  return (
    <div 
      className="h-full w-full bg-black relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: "pan-y" }}
    >
      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-x-0 bg-[#050505]"
            style={{
              top: "max(1rem, env(safe-area-inset-top, 0px))",
              bottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
            }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </LayoutGroup>

      {!isLoading && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
          <div className="pointer-events-auto">
            <BottomNav />
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(BrutalistTheme);
