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

export type MinutesMeterState = "none" | "beta" | "under" | "low" | "over" | "limit" | "under1" | "usedup";

/** Below this share of the included minutes, the meter warns. Matches billing LOW_SHARE. */
const LOW_SHARE = 0.1;

export function minutesMeterState(input: MinutesMeterInput): MinutesMeterState {
  if (input.mode === "none" || !(input.included > 0)) return "none";
  const over = input.used > input.included;
  if (input.mode === "capped" && input.left <= 0) return "limit";
  if (input.mode === "metered" && over) return "over";
  // Beta stays blue even at zero left. Calls keep working, so this is not a hard stop.
  if (input.mode === "beta") {
    if (input.underOne) return "under1";
    if (input.left > 0 && input.left <= Math.max(1, Math.floor(input.included * LOW_SHARE))) return "low";
    return "beta";
  }
  if (input.left <= 0 && !input.underOne) return "usedup";
  if (input.underOne) return "under1";
  const low = input.left > 0 && input.left <= Math.max(1, Math.floor(input.included * LOW_SHARE));
  if (low) return "low";
  return "under";
}

/** Fill of the allowance, 0 to 1. Overage is a separate hatch, not a longer blue bar. */
export function minutesMeterFill(input: MinutesMeterInput): number {
  if (!(input.included > 0)) return 0;
  return Math.max(0, Math.min(1, input.used / input.included));
}

/** Ring shows what is left. Used up is an empty ring, not a full one. */
export function minutesRingFill(input: MinutesMeterInput): number {
  if (minutesMeterState(input) === "usedup" || minutesMeterState(input) === "limit") return 0;
  return minutesMeterFill(input);
}

export type MinutesMeterTone = "info" | "warn" | "danger";

/**
 * The chip word. "Within" stays one short word so it fits a half card
 * and a Kiswahili line of similar length ("Ndani").
 */
export function minutesMeterMark(input: MinutesMeterInput): { word: string; tone: MinutesMeterTone } | null {
  const state = minutesMeterState(input);
  if (state === "none") return null;
  const tone: MinutesMeterTone = state === "limit" ? "danger" : state === "under" || state === "beta" ? "info" : "warn";
  const word =
    state === "usedup"
      ? "No minutes left"
      : state === "limit"
        ? "Limit reached"
        : state === "over"
          ? input.overLabel || "Over the package"
          : state === "under1"
            ? "Under 1 min left"
            : state === "low"
              ? "Low"
              : state === "beta"
                ? "Beta"
                : "Within";
  return { word, tone };
}
