/**
 * Call setup status from the stored picks plus the calls table (computed on read).
 * - Tested: the owner pressed "I tested it" (manual), or the first call for the
 *   business arrived after the step was first opened (auto). Calls rows are calls
 *   into the assistant's number; there is no direction column (checked on staging,
 *   18 Oct), so every row counts as inbound.
 * - Nudge: tested, then no call for 7 days. Dismissal holds until the next call.
 */
import type { CallSetup, CallSetupTestedVia } from "./callSetupStore";

export const NUDGE_QUIET_DAYS = 7;
/** "Calls are coming through" shows until seen, for at most this long after the call. */
export const AUTO_DONE_SHOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CallSetupActivity = {
  /** Earliest call created after call_setup.opened_at, if any. */
  firstCallAfterOpenAt: string | null;
  /** Latest call for the business, if any. */
  lastCallAt: string | null;
};

export type CallSetupStatus = {
  tested: boolean;
  testedVia: CallSetupTestedVia | null;
  testedAt: string | null;
  showFinish: boolean;
  showAutoDone: boolean;
  showNudge: boolean;
  /** Start of the current quiet spell (latest of last call and test). */
  quietSince: string | null;
};

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function resolveCallSetupStatus(input: {
  numberReady: boolean;
  setup: CallSetup | null;
  activity: CallSetupActivity | null;
  now: number;
}): CallSetupStatus {
  const { numberReady, setup, now } = input;
  const activity = input.activity ?? { firstCallAfterOpenAt: null, lastCallAt: null };
  let testedVia: CallSetupTestedVia | null = null;
  let testedAt: string | null = null;
  if (setup?.tested_at) {
    testedVia = setup.tested_via ?? "manual";
    testedAt = setup.tested_at;
  } else {
    const opened = ms(setup?.opened_at);
    const first = ms(activity.firstCallAfterOpenAt);
    if (opened !== null && first !== null && first > opened) {
      testedVia = "auto";
      testedAt = activity.firstCallAfterOpenAt;
    }
  }
  const tested = testedAt !== null;
  const empty = { tested, testedVia, testedAt, showFinish: false, showAutoDone: false, showNudge: false, quietSince: null };
  if (!numberReady) return empty;
  if (!tested) return { ...empty, showFinish: true };

  const testedMs = ms(testedAt) as number;
  const showAutoDone =
    testedVia === "auto" && !setup?.auto_seen_at && now - testedMs < AUTO_DONE_SHOW_DAYS * DAY_MS;

  const last = ms(activity.lastCallAt);
  const quietMs = Math.max(testedMs, last ?? testedMs);
  const quietSince = new Date(quietMs).toISOString();
  const dismissed = ms(setup?.nudge_dismissed_at);
  const quietLongEnough = now - quietMs >= NUDGE_QUIET_DAYS * DAY_MS;
  const showNudge = !showAutoDone && quietLongEnough && !(dismissed !== null && dismissed >= quietMs);
  return { tested, testedVia, testedAt, showFinish: false, showAutoDone, showNudge, quietSince };
}

/** "18 Oct" in the owner's time zone. */
export function shortDay(iso: string | null): string {
  const t = ms(iso);
  if (t === null) return "";
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" }).format(t);
}

export function testedLine(status: Pick<CallSetupStatus, "tested" | "testedVia" | "testedAt">): string {
  if (!status.tested) return "Not tested yet";
  const day = shortDay(status.testedAt);
  return status.testedVia === "auto"
    ? `Working since ${day}`
    : `Tested by you ${day}`;
}

export type CallSetupCardMode = "finish" | "auto" | "nudge" | null;

/** Which Overview card shows (at most one). */
export function callSetupCardMode(status: CallSetupStatus | null): CallSetupCardMode {
  if (!status) return null;
  if (status.showFinish) return "finish";
  if (status.showAutoDone) return "auto";
  if (status.showNudge) return "nudge";
  return null;
}
