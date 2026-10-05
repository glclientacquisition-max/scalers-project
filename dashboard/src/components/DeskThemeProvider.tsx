"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DeskTheme } from "@/lib/deskTheme";

const DeskThemeInitial = createContext<DeskTheme>("system");

export function DeskThemeProvider({
  initial,
  children,
}: {
  initial: DeskTheme;
  children: ReactNode;
}) {
  return <DeskThemeInitial.Provider value={initial}>{children}</DeskThemeInitial.Provider>;
}

export function useDeskThemeInitial(): DeskTheme {
  return useContext(DeskThemeInitial);
}
