/**
 * Call setup status from the stored picks plus the calls table (computed on read).
 * - Tested: the owner pressed "I tested it" (manual), or a call from the owner's test
 *   phone (test_from) arrived within 30 minutes of "Start test" (auto, "Forwarding works").
 * - Any other call after the step was opened only shows "Calls are reaching your
 *   assistant". It does not prove forwarding: it may have been a direct call.
 *   Calls rows are calls into the assistant's number; there is no direction column
 *   (checked on staging, 18 Oct), so every row counts as inbound.
 * - Nudge: tested, then no call for 7 days. Dismissal holds until the next call.
 */
import { kenyaMobileDisplay, toKenyaMobileE164 } from "./callForwarding";
import type { CallSetup, CallSetupOption, CallSetupTestedVia } from "./callSetupStore";

export const NUDGE_QUIET_DAYS = 7;
/** "Forwarding works" shows until seen, for at most this long after the call. */
export const AUTO_DONE_SHOW_DAYS = 14;
/** A test call counts only within this many minutes of "Start test". */
export const TEST_WINDOW_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = TEST_WINDOW_MINUTES * 60 * 1000;

export type CallSetupActivity = {
  /** First call from test_from inside the test window, if any. */
  testMatchAt: string | null;
  /** Earliest call created after call_setup.opened_at, if any. */
  firstCallAfterOpenAt: string | null;
  /** Latest call for the business, if any. */
  lastCallAt: string | null;
  /** Id of the matched test call, for the "it answered" link. */
  testMatchCallId?: string | null;
};

export type TestWindow = "none" | "open" | "over";

export type CallSetupStatus = {
  option: CallSetupOption | null;
  tested: boolean;
  testedVia: CallSetupTestedVia | null;
  testedAt: string | null;
  testFrom: string | null;
  /** A call came in after setup opened, but nothing proved forwarding yet. */
  reaching: boolean;
  testWindow: TestWindow;
  showFinish: boolean;
  showReaching: boolean;
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

/** Same Kenyan mobile? 07.., 254.., +254.. all compare equal. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = toKenyaMobileE164(a);
  return x !== null && x === toKenyaMobileE164(b);
}

/** Earliest call from the test phone within 30 minutes after "Start test". */
export function matchTestCall(
  setup: Pick<CallSetup, "test_from" | "test_started_at"> | null,
  calls: ReadonlyArray<{ caller_number: string | null; created_at: string }>
): string | null {
  const start = ms(setup?.test_started_at);
  if (!setup?.test_from || start === null) return null;
  let best: number | null = null;
  for (const call of calls) {
    const t = ms(call.created_at);
    if (t === null || t < start || t > start + WINDOW_MS) continue;
    if (!samePhone(call.caller_number, setup.test_from)) continue;
    if (best === null || t < best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Id of the call `matchTestCall` picked (same rules), or null. */
export function matchTestCallId(
  setup: Pick<CallSetup, "test_from" | "test_started_at"> | null,
  calls: ReadonlyArray<{ id: string | null; caller_number: string | null; created_at: string }>
): string | null {
  const at = matchTestCall(setup, calls);
  if (!at) return null;
  const t = Date.parse(at);
  return calls.find((c) => c.id && Date.parse(c.created_at) === t && samePhone(c.caller_number, setup?.test_from ?? null))?.id ?? null;
}

/** Shown once: the test call reached the Business Assistant and the owner hasn't seen it yet. */
export function showWinMoment(setup: Pick<CallSetup, "tested_at" | "tested_via" | "auto_seen_at">): boolean {
  return Boolean(setup.tested_at) && setup.tested_via === "auto" && !setup.auto_seen_at;
}

export function testWindow(setup: Pick<CallSetup, "test_started_at"> | null, now: number): TestWindow {
  const start = ms(setup?.test_started_at);
  if (start === null) return "none";
  return now - start <= WINDOW_MS ? "open" : "over";
}

/**
 * The "If it didn't work" checklist: the owner said so, or the window passed with
 * no call from the test phone. Never once tested.
 */
export function showFixChecklist(input: { tested: boolean; saidNo: boolean; window: TestWindow }): boolean {
  if (input.tested) return false;
  return input.saidNo || input.window === "over";
}

export function resolveCallSetupStatus(input: {
  numberReady: boolean;
  setup: CallSetup | null;
  activity: CallSetupActivity | null;
  now: number;
}): CallSetupStatus {
  const { numberReady, setup, now } = input;
  const activity = input.activity ?? { testMatchAt: null, firstCallAfterOpenAt: null, lastCallAt: null };
  let testedVia: CallSetupTestedVia | null = null;
  let testedAt: string | null = null;
  if (setup?.tested_at) {
    testedVia = setup.tested_via ?? "manual";
    testedAt = setup.tested_at;
  } else if (activity.testMatchAt && setup?.test_from && setup.test_started_at) {
    testedVia = "auto";
    testedAt = activity.testMatchAt;
  }
  const tested = testedAt !== null;
  const opened = ms(setup?.opened_at);
  const first = ms(activity.firstCallAfterOpenAt);
  const reaching = !tested && opened !== null && first !== null && first > opened;
  const base: CallSetupStatus = {
    option: setup?.option ?? null,
    tested,
    testedVia,
    testedAt,
    testFrom: setup?.test_from ?? null,
    reaching,
    testWindow: testWindow(setup, now),
    showFinish: false,
    showReaching: false,
    showAutoDone: false,
    showNudge: false,
    quietSince: null,
  };
  if (!numberReady) return base;
  if (!tested) return { ...base, showFinish: !reaching, showReaching: reaching };

  const testedMs = ms(testedAt) as number;
  const showAutoDone =
    testedVia === "auto" && !setup?.auto_seen_at && now - testedMs < AUTO_DONE_SHOW_DAYS * DAY_MS;

  const last = ms(activity.lastCallAt);
  const quietMs = Math.max(testedMs, last ?? testedMs);
  const dismissed = ms(setup?.nudge_dismissed_at);
  const quietLongEnough = now - quietMs >= NUDGE_QUIET_DAYS * DAY_MS;
  const showNudge = !showAutoDone && quietLongEnough && !(dismissed !== null && dismissed >= quietMs);
  return { ...base, showAutoDone, showNudge, quietSince: new Date(quietMs).toISOString() };
}

/** "18 Oct" in the owner's time zone. */
export function shortDay(iso: string | null): string {
  const t = ms(iso);
  if (t === null) return "";
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" }).format(t);
}

/** What an automatic test proves, by option. */
export function worksTitle(option: CallSetupOption | null): string {
  return option === "main_number" ? "Your number works" : "Forwarding works";
}

/** Settings status: a short title and one detail line. */
export function testedLine(
  status: Pick<CallSetupStatus, "tested" | "testedVia" | "testedAt" | "testFrom" | "reaching" | "option">
): { title: string; detail: string | null; ok: boolean } {
  const day = shortDay(status.testedAt);
  if (status.tested && status.testedVia === "auto") {
    const from = status.testFrom ? ` from ${kenyaMobileDisplay(status.testFrom)}` : "";
    return { title: worksTitle(status.option), detail: `Test call${from} on ${day}`, ok: true };
  }
  if (status.tested) return { title: "Tested by you", detail: day, ok: true };
  if (status.reaching) {
    return {
      title: "Calls are reaching your Business Assistant",
      detail: status.option === "main_number" ? "Not tested yet" : "Forwarding not tested yet",
      ok: false,
    };
  }
  return { title: "Not tested yet", detail: null, ok: false };
}

export type CallSetupCardMode = "finish" | "reaching" | "auto" | "nudge" | null;

/** Which Overview card shows (at most one). */
export function callSetupCardMode(status: CallSetupStatus | null): CallSetupCardMode {
  if (!status) return null;
  if (status.showFinish) return "finish";
  if (status.showReaching) return "reaching";
  if (status.showAutoDone) return "auto";
  if (status.showNudge) return "nudge";
  return null;
}

/**
 * Pre-fill for "Which phone will you test from?": the first teammate with a Kenyan
 * mobile that isn't the assistant's number or the owner's own alert phone (often the
 * business line itself). Contacts are callers, so they're never used. Null: empty field.
 */
export function suggestTestPhone(
  team: ReadonlyArray<{ phone?: string | null }> | null | undefined,
  exclude: ReadonlyArray<string | null | undefined> = []
): string | null {
  const skip = new Set(exclude.map((p) => toKenyaMobileE164(p)).filter(Boolean));
  for (const member of team ?? []) {
    const e164 = toKenyaMobileE164(member?.phone);
    if (e164 && !skip.has(e164)) return e164;
  }
  return null;
}
