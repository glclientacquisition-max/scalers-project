"use client";

import { useLayoutEffect } from "react";
import { applyDeskEffects, readDeskEffects } from "@/lib/deskEffects";

/** Re-applies a stored Reduce effects choice after hydration, before paint. */
export function DeskEffectsBoot() {
  useLayoutEffect(() => {
    applyDeskEffects(readDeskEffects());
  }, []);
  return null;
}
