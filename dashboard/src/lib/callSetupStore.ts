/**
 * Owner picks for "Set up your calls".
 *
 * Source of truth: `tenants.call_setup jsonb` (migration 20261018130000_tenant_call_setup.sql),
 * written only through the save_call_setup RPC (membership checked in SQL). Same shape as the
 * v1 browser value `scalers.callSetup.v1.<tenantId>` (PR #755) plus opened/tested/nudge fields.
 * Browser storage stays as a cache and as the fallback before the column exists, and its v1
 * value is copied up once (see migrateLocalToDb).
 */
import {
  FORWARD_CHOICES,
  NETWORKS,
  ringSeconds,
  toKenyaMobileE164,
  type ForwardChoice,
  type NetworkId,
  type PhoneKind,
  type RingSeconds,
} from "./callForwarding";

export type CallSetupOption = "main_number" | "forward";
export type CallSetupTestedVia = "manual" | "auto";

export type CallSetup = {
  option: CallSetupOption | null;
  network: NetworkId | null;
  phone: PhoneKind | null;
  choices: ForwardChoice[];
  ring_seconds: RingSeconds;
  /** ISO time setup was marked done (owner pressed "I tested it"). */
  tested_at: string | null;
  tested_via: CallSetupTestedVia | null;
  /** First time the owner opened the step. A call after this shows "Calls are reaching your assistant". */
  opened_at: string | null;
  /** Phone the owner tests from (+254 E.164). Only its call, in the test window, proves forwarding. */
  test_from: string | null;
  /** When the owner pressed "Start test". The window is 30 minutes from here. */
  test_started_at: string | null;
  /** "Check your call setup" note dismissed at. */
  nudge_dismissed_at: string | null;
  /** "Calls are coming through" note seen at. */
  auto_seen_at: string | null;
  updated_at: string | null;
};

export const CALL_SETUP_VERSION = 1;

export function emptyCallSetup(): CallSetup {
  return {
    option: null,
    network: null,
    phone: null,
    choices: ["all"],
    ring_seconds: 20,
    tested_at: null,
    tested_via: null,
    opened_at: null,
    test_from: null,
    test_started_at: null,
    nudge_dismissed_at: null,
    auto_seen_at: null,
    updated_at: null,
  };
}

export function callSetupKey(tenantId: string): string {
  return `scalers.callSetup.v${CALL_SETUP_VERSION}.${tenantId}`;
}

/** Normalised to ISO 8601 UTC so the account copy passes the database check. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Accepts anything (stored JSON, a DB row) and returns a clean value. */
export function parseCallSetup(raw: unknown): CallSetup {
  const base = emptyCallSetup();
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const row = value as Record<string, unknown>;
  const option = row.option === "main_number" || row.option === "forward" ? row.option : null;
  const network = NETWORKS.includes(row.network as NetworkId) ? (row.network as NetworkId) : null;
  const phone = row.phone === "android" || row.phone === "iphone" ? row.phone : null;
  const picked = Array.isArray(row.choices)
    ? (row.choices.filter((c) => FORWARD_CHOICES.includes(c as ForwardChoice)) as ForwardChoice[])
    : [];
  const unique = [...new Set(picked)];
  const choices: ForwardChoice[] = unique.includes("all") ? ["all"] : unique.length ? unique : ["all"];
  const tested = isoOrNull(row.tested_at);
  const via = row.tested_via === "manual" || row.tested_via === "auto" ? row.tested_via : null;
  return {
    option,
    network,
    phone,
    choices,
    ring_seconds: ringSeconds(row.ring_seconds),
    tested_at: tested,
    // v1 values only knew the button.
    tested_via: tested ? via ?? "manual" : null,
    opened_at: isoOrNull(row.opened_at),
    test_from: toKenyaMobileE164(row.test_from),
    test_started_at: isoOrNull(row.test_started_at),
    nudge_dismissed_at: isoOrNull(row.nudge_dismissed_at),
    auto_seen_at: isoOrNull(row.auto_seen_at),
    updated_at: isoOrNull(row.updated_at),
  };
}

/** Owner picked or confirmed something (worth copying up from the browser). */
export function hasCallSetupContent(setup: CallSetup | null | undefined): boolean {
  return Boolean(setup && (setup.option || setup.tested_at || setup.network));
}

/**
 * One-time copy of the v1 browser value into the account.
 * Only when the account has nothing yet and the browser has picks. Opened time is
 * "now": calls before the copy never count as an automatic test.
 */
export function migrateLocalToDb(
  db: CallSetup | null,
  local: CallSetup | null,
  nowIso: string
): CallSetup | null {
  if (db) return null;
  if (!hasCallSetupContent(local)) return null;
  const clean = parseCallSetup(local);
  return { ...clean, opened_at: clean.opened_at ?? nowIso };
}

/**
 * Merge a patch onto the stored value. Opening the step stamps opened_at once.
 * Clearing the test (Test again) clears how it was tested too.
 */
export function mergeCallSetup(
  current: CallSetup | null,
  patch: Partial<CallSetup>,
  opts: { nowIso: string; opened?: boolean }
): CallSetup {
  const base = current ?? emptyCallSetup();
  const next = parseCallSetup({ ...base, ...patch });
  if (opts.opened && !next.opened_at) next.opened_at = base.opened_at ?? opts.nowIso;
  if (!next.tested_at) next.tested_via = null;
  return next;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

export type CallSetupStore = {
  load(tenantId: string): CallSetup;
  save(tenantId: string, value: CallSetup): void;
};

export function localCallSetupStore(storage: KeyValue | null | undefined): CallSetupStore {
  return {
    load(tenantId) {
      try {
        return parseCallSetup(storage?.getItem(callSetupKey(tenantId)) ?? null);
      } catch {
        return emptyCallSetup();
      }
    },
    save(tenantId, value) {
      try {
        storage?.setItem(callSetupKey(tenantId), JSON.stringify(parseCallSetup(value)));
      } catch {
        /* private mode or full storage: the step still works for this visit */
      }
    },
  };
}

export function browserCallSetupStore(): CallSetupStore {
  return localCallSetupStore(typeof window === "undefined" ? null : window.localStorage);
}

/** Overview card (browser-storage fallback): shown once the number exists, until tested. */
export function showFinishCallsCard(input: { numberReady: boolean; setup: CallSetup | null }): boolean {
  if (!input.numberReady) return false;
  return !input.setup?.tested_at;
}

/** Busy line in the test step only when the busy choice is on (alone or in "all"). */
export function testIncludesBusy(choices: readonly ForwardChoice[]): boolean {
  return choices.includes("all") || choices.includes("busy");
}
