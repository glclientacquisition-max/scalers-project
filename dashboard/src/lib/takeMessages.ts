/**
 * "Take messages only" (tenants.brain_mode = 'safe') and "My list is complete"
 * (tenants.kb_catalogue_complete_at): the Desk words and the small rules around them.
 * Pure: safe for client and server. The decision itself comes from the shared
 * brainMode() in kbLive.server (owner | admin | env | default); Desk never recomputes it.
 */

/** Who turned it on. null = off (or never set). */
export type TakeMessagesBy = "owner" | "admin" | "env" | null;

export type TakeMessagesState = {
  on: boolean;
  by: TakeMessagesBy;
  /** tenants.brain_mode_set_at (last change), ISO. */
  setAt: string | null;
};

export type BrainModeReason = "env" | "owner" | "admin" | "default" | "no_tenant" | string;

/** brainMode() decision + set_at -> the Desk state. Unknown reasons read as off. */
export function takeMessagesState(decision: { mode: string; reason: BrainModeReason }, setAt: string | null = null): TakeMessagesState {
  const on = decision.mode === "safe";
  if (!on) return { on: false, by: null, setAt };
  const by: TakeMessagesBy = decision.reason === "env" ? "env" : decision.reason === "owner" ? "owner" : "admin";
  return { on: true, by, setAt };
}

/** The owner may flip it when it is off, or when the owner turned it on. Support and env holds stay. */
export function ownerCanChange(state: TakeMessagesState): boolean {
  return !state.on || state.by === "owner";
}

/** Settings > Identity, How you answer. The switch row has the id `take-messages`. */
export const TAKE_MESSAGES_HREF = "/settings?tab=train&panel=identity#take-messages";

export const TAKE_MESSAGES_COPY = {
  label: "Take messages only",
  help: "Your assistant takes the caller's name, number and reason, and sends it to you. It won't quote prices or book.",
  onOwner: "On. Your assistant takes a message on every call and sends it to you. Turn it off to answer questions and book again.",
  onAdmin: "Turned on by Scalers support. To turn it off, contact Scalers support.",
  onEnv: "Turned on by Scalers for every business for now. You don't need to do anything.",
  indicator: "Taking messages only",
  pill: "Taking messages only",
} as const;

/** The line under the switch for each state. */
export function takeMessagesLine(state: TakeMessagesState): string {
  if (!state.on) return TAKE_MESSAGES_COPY.help;
  if (state.by === "env") return TAKE_MESSAGES_COPY.onEnv;
  if (state.by === "admin") return TAKE_MESSAGES_COPY.onAdmin;
  return TAKE_MESSAGES_COPY.onOwner;
}

/** Inbox header note beside the indicator: who turned it on, when it was not the owner. */
export function takeMessagesIndicatorNote(state: TakeMessagesState): string | null {
  if (!state.on) return null;
  if (state.by === "env") return "Turned on by Scalers";
  if (state.by === "admin") return "Turned on by Scalers support";
  return null;
}

const errorWords: Record<string, string> = {
  forbidden: "Only the owner or an admin can change this.",
  not_found: "We couldn't find your business. Reload the page.",
  rpc_missing: "This setting isn't ready yet. Try again later.",
  invalid_mode: "Couldn't save. Reload the page and try again.",
  invalid_complete: "Couldn't save. Reload the page and try again.",
};

/** RPC error codes from kbLive.server -> one plain line. */
export function brainSettingError(code: string): string {
  return errorWords[code] || "Couldn't save. Check your connection and try again.";
}

/* ---------------- My list is complete ---------------- */

export const CATALOGUE_COMPLETE_COPY = {
  label: "My list is complete",
  on: "Callers who ask for something not on this list hear that you don't offer it.",
  off: "Callers who ask for something not on this list hear that your team will confirm.",
} as const;

export function catalogueCompleteLine(complete: boolean): string {
  return complete ? CATALOGUE_COMPLETE_COPY.on : CATALOGUE_COMPLETE_COPY.off;
}

const DAY = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });

/** "Marked 28 Oct 2026" (Nairobi day). Null for a missing or bad stamp. */
export function markedOnLine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Marked ${DAY.format(d)}`;
}
