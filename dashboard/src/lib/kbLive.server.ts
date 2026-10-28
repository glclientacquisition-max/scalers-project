import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireVoice } from "@/lib/voiceRequire.server";

/**
 * Desk side of the shared "this business is on the KB" contract (docs/reference/platform/KB_V2.md, "isKbLive").
 * The rule itself lives ONCE in src/knowledge/kb/kbLive.js (Voice's brain selector calls the same function);
 * Desk never recomputes readiness. This file only loads the facts and passes the gate, like hashMode:
 * the gate is BRAIN_KB_GATE from THIS server's env (never the client), so Desk must carry the same value as Voice.
 */
export type KbLiveReason = "gate_off" | "no_facts" | "held_v1" | "no_live_version" | "never_ready" | "ready_stale" | "ready";
export type KbLiveDecision = { live: boolean; reason: KbLiveReason };
export type KbLiveFacts = { kb_live_version: number | null; kb_ready_version: number | null; brain_target: string | null };

type KbLiveModule = {
  isKbLive: (tenant: Partial<KbLiveFacts> | null | undefined, opts: { gate?: boolean | string | null }) => KbLiveDecision;
  kbGateOn: (gate: boolean | string | null | undefined) => boolean;
  KB_LIVE_COLUMNS: string;
};
const mod = () => requireVoice<KbLiveModule>("./src/knowledge/kb/kbLive.js");

/** BRAIN_KB_GATE as this server sees it (raw string; the shared module parses it). */
export function deskKbGate(): string | undefined {
  return process.env.BRAIN_KB_GATE;
}

/** The shared predicate. Pass a tenants row (or any object with the three columns); gate defaults to this server's env. */
export function isKbLive(tenant: Partial<KbLiveFacts> | null | undefined, opts: { gate?: boolean | string | null } = { gate: deskKbGate() }): KbLiveDecision {
  return mod().isKbLive(tenant, opts);
}

/**
 * Load the facts for one business and decide. Service role: call only after the member / admin check in the caller.
 * A read error or missing columns (prod before kb_v2.sql) gives { live: false, reason: "no_facts" }, same as Voice.
 */
export async function loadKbLive(tenantId: string, opts: { gate?: boolean | string | null } = { gate: deskKbGate() }): Promise<KbLiveDecision & { facts: KbLiveFacts | null }> {
  const m = mod();
  if (!m.kbGateOn(opts.gate)) return { ...m.isKbLive(null, opts), facts: null };
  const { data, error } = await getSupabaseAdmin().from("tenants").select(m.KB_LIVE_COLUMNS).eq("id", tenantId).maybeSingle();
  const facts = error || !data ? null : (data as unknown as KbLiveFacts);
  return { ...m.isKbLive(facts, opts), facts };
}
