import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireVoice } from "@/lib/voiceRequire.server";

/**
 * Desk side of the shared KB contract (docs/reference/platform/KB_V2.md, "isKbLive" + "Retire the old brain").
 * The rules live ONCE in src/knowledge/kb/kbLive.js (Voice calls the same functions); Desk never recomputes them.
 * Gate on: every business is on the KB brain and `reason` is readiness / quality only (Fix card, Super Admin).
 * Gate off: "gate_off" (kill switch, removed in P2). The gate is BRAIN_KB_GATE from THIS server's env and the
 * safe-mode override is BRAIN_SAFE_MODE from this server's env, both passed in like hashMode, never read on the client.
 */
/** "held_v1" is never returned any more (kept so older callers still type-check). */
export type KbLiveReason = "gate_off" | "no_facts" | "no_live_version" | "never_ready" | "ready_stale" | "ready" | "held_v1";
export type KbLiveDecision = { live: boolean; reason: KbLiveReason };
export type BrainMode = "full" | "safe";
/** env = BRAIN_SAFE_MODE=all (wins); owner = Desk toggle; admin = Super Admin; default = full. */
export type BrainModeDecision = { mode: BrainMode; reason: "env" | "owner" | "admin" | "default" };
/** brain_target is ignored (no v1 hold); dropped by kb_v2_drop_brain_target.sql in P2. */
export type KbLiveFacts = { kb_live_version: number | null; kb_ready_version: number | null; brain_mode?: string | null; brain_mode_source?: string | null; brain_target?: string | null };

type Facts = Partial<KbLiveFacts> | null | undefined;
type KbLiveModule = {
  isKbLive: (tenant: Facts, opts: { gate?: boolean | string | null }) => KbLiveDecision;
  brainMode: (tenant: Facts, opts: { safeEnv?: string | null }) => BrainModeDecision;
  kbGateOn: (gate: boolean | string | null | undefined) => boolean;
  KB_LIVE_COLUMNS: string;
  KB_LIVE_COLUMNS_PRE_BRAIN_MODE: string;
};
const mod = () => requireVoice<KbLiveModule>("./src/knowledge/kb/kbLive.js");

/** BRAIN_KB_GATE as this server sees it (raw string; the shared module parses it). */
export function deskKbGate(): string | undefined {
  return process.env.BRAIN_KB_GATE;
}
/** BRAIN_SAFE_MODE as this server sees it ('all' = every business on safe mode). */
export function deskSafeEnv(): string | undefined {
  return process.env.BRAIN_SAFE_MODE;
}

/** The shared predicate. Pass a tenants row (or any object with the columns); gate defaults to this server's env. */
export function isKbLive(tenant: Facts, opts: { gate?: boolean | string | null } = { gate: deskKbGate() }): KbLiveDecision {
  return mod().isKbLive(tenant, opts);
}
/** The shared brain mode for one business; safeEnv defaults to this server's BRAIN_SAFE_MODE. */
export function brainMode(tenant: Facts, opts: { safeEnv?: string | null } = { safeEnv: deskSafeEnv() }): BrainModeDecision {
  return mod().brainMode(tenant, opts);
}

/**
 * Load the facts for one business and decide. Service role: call only after the member / admin check in the caller.
 * Before kb_v2_brain_mode.sql there is no brain_mode column: read without it (= full). A read error is "no_facts".
 */
export async function loadKbLive(
  tenantId: string,
  opts: { gate?: boolean | string | null } = { gate: deskKbGate() },
): Promise<KbLiveDecision & { mode: BrainModeDecision; facts: KbLiveFacts | null }> {
  const m = mod();
  const mode0 = m.brainMode(null, { safeEnv: deskSafeEnv() });
  if (!m.kbGateOn(opts.gate)) return { ...m.isKbLive(null, opts), mode: mode0, facts: null };
  const sb = getSupabaseAdmin();
  let r = await sb.from("tenants").select(m.KB_LIVE_COLUMNS).eq("id", tenantId).maybeSingle();
  if (r.error && /brain_mode/.test(r.error.message || "")) r = await sb.from("tenants").select(m.KB_LIVE_COLUMNS_PRE_BRAIN_MODE).eq("id", tenantId).maybeSingle();
  const facts = r.error || !r.data ? null : (r.data as unknown as KbLiveFacts);
  return { ...m.isKbLive(facts, opts), mode: m.brainMode(facts, { safeEnv: deskSafeEnv() }), facts };
}

export type SetBrainModeResult =
  | { ok: true; mode: BrainMode; from: BrainMode | null; source: "owner" | "admin"; setAt: string | null }
  | { ok: false; error: "invalid_mode" | "forbidden" | "not_found" | "rpc_missing" | "failed" };

function setBrainModeError(message: string): Exclude<SetBrainModeResult, { ok: true }>["error"] {
  if (/invalid_mode/.test(message)) return "invalid_mode";
  if (/forbidden/.test(message)) return "forbidden";
  if (/not_found/.test(message)) return "not_found";
  if (/set_brain_mode|PGRST202|does not exist/.test(message)) return "rpc_missing";
  return "failed";
}

/**
 * Desk Settings "Take messages only" toggle: mode "safe" = on, "full" = off. Calls public.set_brain_mode with the
 * signed-in user's session (cookie client), so the database checks the caller is an owner / admin member of
 * tenantId and writes only brain_mode + brain_mode_set_by / _set_at / _source ('owner') and one audit row.
 * Never uses the service role. BRAIN_SAFE_MODE=all (env) still overrides; read it back with loadKbLive(...).mode.
 */
export async function setBrainModeAsOwner(tenantId: string, mode: BrainMode): Promise<SetBrainModeResult> {
  if (mode !== "full" && mode !== "safe") return { ok: false, error: "invalid_mode" };
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("set_brain_mode", { p_tenant: tenantId, p_mode: mode });
  if (error) return { ok: false, error: setBrainModeError(`${error.code || ""} ${error.message || ""}`) };
  const d = (data || {}) as { brain_mode?: BrainMode; from?: BrainMode | null; source?: "owner" | "admin"; set_at?: string | null };
  return { ok: true, mode: d.brain_mode || mode, from: d.from ?? null, source: d.source || "owner", setAt: d.set_at ?? null };
}

/** Super Admin (service role, after the Admin sign-in / Unlock checks in the route): source 'admin', audited. */
export async function setBrainModeAsAdmin(tenantId: string, mode: BrainMode, actorUserId: string | null): Promise<SetBrainModeResult> {
  if (mode !== "full" && mode !== "safe") return { ok: false, error: "invalid_mode" };
  const { data, error } = await getSupabaseAdmin().rpc("set_brain_mode", { p_tenant: tenantId, p_mode: mode, p_actor: actorUserId });
  if (error) return { ok: false, error: setBrainModeError(`${error.code || ""} ${error.message || ""}`) };
  const d = (data || {}) as { brain_mode?: BrainMode; from?: BrainMode | null; source?: "owner" | "admin"; set_at?: string | null };
  return { ok: true, mode: d.brain_mode || mode, from: d.from ?? null, source: d.source || "admin", setAt: d.set_at ?? null };
}
