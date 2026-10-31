import type { DemoBusinessKey, DemoLang } from "./copy";

export const DEMO_STATES = [
  "idle",
  "consent",
  "mic_denied",
  "connecting",
  "live",
  "ended",
  "disabled",
  "busy",
  "cap",
  "request",
  "requested",
  "limit",
  "error",
  "unsupported",
] as const;

export type DemoState = (typeof DEMO_STATES)[number];

export const DEMO_MAX_SEC = 180;

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export type TokenFailureReason =
  | "origin"
  | "turnstile"
  | "rate"
  | "limit_daily"
  | "busy"
  | "cap"
  | "used"
  | "disabled"
  | "error";

/** Map a POST /demo/token error onto a widget state. `used` is not the daily limit. */
export function stateForTokenFailure(status: number, reason: string): DemoState {
  if (status === 503 && reason === "disabled") return "disabled";
  if (status === 503 && reason === "cap") return "cap";
  if (status === 503 && reason === "busy") return "busy";
  if (status === 429 && reason === "used") return "request";
  if (status === 429 && (reason === "limit_daily" || reason === "rate")) return "limit";
  return "error";
}

export function isDemoState(value: string): value is DemoState {
  return (DEMO_STATES as readonly string[]).includes(value);
}

export type DemoView = {
  state: DemoState;
  lang: DemoLang;
  business: DemoBusinessKey | null;
};

export function initialView(lang: DemoLang = "en"): DemoView {
  return { state: "idle", lang, business: null };
}
