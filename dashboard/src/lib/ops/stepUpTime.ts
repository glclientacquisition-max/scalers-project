/**
 * Unlock length helpers (Alvin, 24 Oct 2026). Pure, no imports: safe for the client
 * (Settings › Security countdown) and the server (grant expiry, cookie maxAge).
 */
/** Settings › Security "Unlock lasts" (Alvin, 24 Oct 2026). Choices shown; server clamps any value. */
export const UNLOCK_MINUTES_CHOICES = [5, 10, 15, 30] as const;
export const UNLOCK_MIN_MINUTES = 5;
export const UNLOCK_MAX_MINUTES = 30;
export const UNLOCK_DEFAULT_MINUTES = 10;

/** Clamp to 5–30 whole minutes; junk falls back to the 10-minute default. */
export function clampUnlockMinutes(v: unknown): number {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (v == null || typeof v === "boolean" || !Number.isFinite(n)) return UNLOCK_DEFAULT_MINUTES;
  return Math.min(UNLOCK_MAX_MINUTES, Math.max(UNLOCK_MIN_MINUTES, Math.round(n)));
}

export function unlockTtlMs(minutes: unknown): number {
  return clampUnlockMinutes(minutes) * 60 * 1000;
}

/** Time left on an Unlock, from the server's unlockedUntil (what the Security countdown shows). */
export function unlockTimeLeft(until: string | null | undefined, nowMs: number): { left: number; text: string } {
  const t = until ? Date.parse(until) : NaN;
  const left = Number.isFinite(t) ? Math.max(0, t - nowMs) : 0;
  return { left, text: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` };
}
