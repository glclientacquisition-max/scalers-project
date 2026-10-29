"use client";

import { useCallback, useEffect, useState } from "react";
import { unlockTimeLeft } from "@/lib/ops/stepUpTime";

export const STEP_UP_UNLOCKED_EVENT = "scalers:step-up-unlocked";

type StepUpStatus = {
  mode: "off" | "observe" | "enforce";
  unlockedUntil?: string | null;
  lockedUntil?: string | null;
  enrolled?: boolean;
  needsReenrol?: boolean;
};

/** Live Unlock grant from GET /api/admin/step-up (server is source of truth for risky writes). */
export function useAdminUnlockSession() {
  const [status, setStatus] = useState<StepUpStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/step-up", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as StepUpStatus);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnlocked = () => void refresh();
    window.addEventListener(STEP_UP_UNLOCKED_EVENT, onUnlocked);
    return () => window.removeEventListener(STEP_UP_UNLOCKED_EVENT, onUnlocked);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!status?.unlockedUntil) return;
    const poll = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(poll);
  }, [status?.unlockedUntil, refresh]);

  const remaining = unlockTimeLeft(status?.unlockedUntil ?? null, now);
  const unlocked = remaining.left > 0;
  const locked =
    !!status?.lockedUntil && Number.isFinite(Date.parse(status.lockedUntil)) && Date.parse(status.lockedUntil) > now;

  return { status, unlocked, locked, lockedUntil: status?.lockedUntil ?? null, remaining, refresh };
}
