/** DESK_FEEL=on: subtle haptics and slightly springier sheet motion. Off by default. */

const PULSE_MS = 12;

function deskFeelOn(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.dataset.deskFeel === "on" ||
    Boolean(document.querySelector("[data-desk-feel='on']"))
  );
}

/** Short pulse on primary confirms (navigator.vibrate where supported). */
export function deskConfirmHaptic(): void {
  if (typeof window === "undefined" || !deskFeelOn()) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  try {
    nav.vibrate?.(PULSE_MS);
  } catch {
    /* ignore */
  }
}
