"use client";
import { createContext, useContext } from "react";
import type { useAcademiaData } from "@/hooks/useAcademiaData";

interface AppLayoutContextType {
  onOpenSettings: () => void;
  isSwipeDisabled: boolean;
  setIsSwipeDisabled: (disabled: boolean) => void;
}

export const AppLayoutContext = createContext<AppLayoutContextType | undefined>(undefined);

export function useAppLayout() {
  const context = useContext(AppLayoutContext);
  if (!context) throw new Error("useAppLayout must be used within AppLayout");
  return context;
}

export const AcademiaContext = createContext<ReturnType<typeof useAcademiaData> | undefined>(undefined);

export function useAcademia() {
  const context = useContext(AcademiaContext);
  if (!context) throw new Error("useAcademia must be used within AppLayout");
  return context;
}
