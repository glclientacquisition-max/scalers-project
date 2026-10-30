/** Minutes against the package. Pure. No sample numbers. */

export type MinutesMeterMode = "beta" | "metered" | "capped" | "none";

export type MinutesMeterInput = {
  included: number;
  used: number;
  left: number;
  underOne: boolean;
  mode: MinutesMeterMode;
  /** Already formatted, from billing. Null when there is no overage label. */
  overLabel: string | null;
};

export type MinutesMeterState = "none" | "beta" | "under" | "low" | "over" | "limit" | "under1";

/** Below this share of the included minutes, the meter warns. Matches billing LOW_SHARE. */
const LOW_SHARE = 0.1;

export function minutesMeterState(input: MinutesMeterInput): MinutesMeterState {
  if (input.mode === "none" || !(input.included > 0)) return "none";
  const over = input.used > input.included;
  if (input.mode === "capped" && input.left <= 0) return "limit";
  if (input.mode === "metered" && over) return "over";
  if (input.underOne) return "under1";
  const low = input.left <= Math.max(1, Math.floor(input.included * LOW_SHARE));
  if (input.mode === "beta") return low ? "low" : "beta";
  if (low) return "low";
  return "under";
}

/** Fill of the allowance, 0 to 1. Overage is a separate hatch, not a longer blue bar. */
export function minutesMeterFill(input: MinutesMeterInput): number {
  if (!(input.included > 0)) return 0;
  return Math.max(0, Math.min(1, input.used / input.included));
}
