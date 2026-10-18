/**
 * Owner picks for "Set up your calls". v1 lives in localStorage under a
 * tenant-scoped key (no migration). The shape matches a future
 * `tenants.call_setup jsonb` column: swap `localCallSetupStore` for a server-backed
 * store with the same `load`/`save` and nothing else changes.
 */
import {
  FORWARD_CHOICES,
  NETWORKS,
  ringSeconds,
  type ForwardChoice,
  type NetworkId,
  type PhoneKind,
  type RingSeconds,
} from "./callForwarding";

export type CallSetupOption = "main_number" | "forward";

export type CallSetup = {
  option: CallSetupOption | null;
  network: NetworkId | null;
  phone: PhoneKind | null;
  choices: ForwardChoice[];
  ring_seconds: RingSeconds;
  /** ISO time the owner pressed "I tested it". */
  tested_at: string | null;
};

export const CALL_SETUP_VERSION = 1;

export function emptyCallSetup(): CallSetup {
  return { option: null, network: null, phone: null, choices: ["all"], ring_seconds: 20, tested_at: null };
}

export function callSetupKey(tenantId: string): string {
  return `scalers.callSetup.v${CALL_SETUP_VERSION}.${tenantId}`;
}

/** Accepts anything (stored JSON, a future DB row) and returns a clean value. */
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
  if (!value || typeof value !== "object") return base;
  const row = value as Record<string, unknown>;
  const option = row.option === "main_number" || row.option === "forward" ? row.option : null;
  const network = NETWORKS.includes(row.network as NetworkId) ? (row.network as NetworkId) : null;
  const phone = row.phone === "android" || row.phone === "iphone" ? row.phone : null;
  const picked = Array.isArray(row.choices)
    ? (row.choices.filter((c) => FORWARD_CHOICES.includes(c as ForwardChoice)) as ForwardChoice[])
    : [];
  const unique = [...new Set(picked)];
  const choices: ForwardChoice[] = unique.includes("all") ? ["all"] : unique.length ? unique : ["all"];
  const tested = typeof row.tested_at === "string" && !Number.isNaN(Date.parse(row.tested_at)) ? row.tested_at : null;
  return { option, network, phone, choices, ring_seconds: ringSeconds(row.ring_seconds), tested_at: tested };
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

/** Overview card: shown once the number exists, until the owner has tested. */
export function showFinishCallsCard(input: { numberReady: boolean; setup: CallSetup | null }): boolean {
  if (!input.numberReady) return false;
  return !input.setup?.tested_at;
}

/** Busy line in the test step only when the busy choice is on (alone or in "all"). */
export function testIncludesBusy(choices: readonly ForwardChoice[]): boolean {
  return choices.includes("all") || choices.includes("busy");
}
