import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { recordAdminAction } from "@/lib/adminAudit";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { pingKbCompile } from "@/lib/kb.server";
import { stepUpGate } from "@/lib/ops/stepUpGate";
import { getSupabaseAdmin } from "@/lib/supabase";
import { brainMode, isKbLive, setBrainModeAsAdmin, type KbLiveReason } from "@/lib/kbLive.server";
import { takeMessagesState, type TakeMessagesState } from "@/lib/takeMessages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BusinessKbView = {
  liveVersion: number | null;
  readyVersion: number | null;
  brainTarget: "v1" | "v2";
  /** The shared isKbLive (kbLive.server, this server's BRAIN_KB_GATE): the same answer Voice gives. */
  onNewBrain: boolean;
  onNewBrainReason: KbLiveReason;
  items: number | null;
  /** "Take messages only" (tenants.brain_mode via the shared brainMode). null = columns not there yet (SQL .4). */
  takeMessages: TakeMessagesState | null;
  readiness: { passed: boolean; version: number | null; checkedAt: string; by: string | null; checks: { id: string; ok: boolean; fix?: string | null }[]; tests: { name: string; ok: boolean; heard?: string | null; why?: string | null }[] } | null;
};

type TenantKbRow = { kb_live_version: number | null; kb_ready_version: number | null; brain_target: string | null; brain_mode?: string | null; brain_mode_source?: string | null; brain_mode_set_at?: string | null };

/** The tenants facts, with the brain_mode columns when SQL .4 is applied (read without them before). */
async function tenantKbRow(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<{ data: TenantKbRow | null; error: { message?: string } | null }> {
  const full = await sb.from("tenants").select("kb_live_version, kb_ready_version, brain_target, brain_mode, brain_mode_source, brain_mode_set_at").eq("id", id).maybeSingle();
  if (!full.error || !/brain_mode/.test(full.error.message || "")) return { data: (full.data as TenantKbRow | null) ?? null, error: full.error };
  const old = await sb.from("tenants").select("kb_live_version, kb_ready_version, brain_target").eq("id", id).maybeSingle();
  return { data: (old.data as TenantKbRow | null) ?? null, error: old.error };
}

/** Read-only: the Business's v2 knowledge and readiness (Calls & quality section). Null parts when the v2 tables are not there. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLegacyAuthenticated())) return NextResponse.json({ error: "ops_only" }, { status: 403 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "business id required" }, { status: 400 });
  const sb = getSupabaseAdmin();
  const [t, r, s] = await Promise.all([
    tenantKbRow(sb, id),
    sb.from("kb_readiness").select("snapshot_version, passed, checks, tests, checked_by, checked_at").eq("tenant_id", id).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("kb_snapshots").select("item_count").eq("tenant_id", id).eq("status", "live").maybeSingle(),
  ]);
  if (t.error) return NextResponse.json({ available: false });
  const live = t.data?.kb_live_version ?? null;
  const ready = t.data?.kb_ready_version ?? null;
  const target = t.data?.brain_target === "v1" ? "v1" : "v2";
  const decision = isKbLive(t.data);
  const row: Partial<TenantKbRow> = t.data || {};
  const takeMessages = row.brain_mode !== undefined ? takeMessagesState(brainMode(row), row.brain_mode_set_at ?? null) : null;
  type Raw = { snapshot_version: number | null; passed: boolean; checks: NonNullable<BusinessKbView["readiness"]>["checks"] | null; tests: NonNullable<BusinessKbView["readiness"]>["tests"] | null; checked_by: string | null; checked_at: string };
  const rr = r.data as Raw | null;
  const view: BusinessKbView = {
    liveVersion: live,
    readyVersion: ready,
    brainTarget: target,
    onNewBrain: decision.live,
    onNewBrainReason: decision.reason,
    items: (s.data as { item_count?: number } | null)?.item_count ?? null,
    takeMessages,
    readiness: rr ? { passed: rr.passed, version: rr.snapshot_version, checkedAt: rr.checked_at, by: rr.checked_by, checks: rr.checks || [], tests: rr.tests || [] } : null,
  };
  return NextResponse.json({ available: true, ...view });
}

/**
 * check: re-run readiness on Voice now (safe, read-only apart from the kb_readiness row).
 * set_brain_target: hold a Business on the old brain (v1) or let readiness move it (v2). Risky: Unlock + reason.
 * set_brain_mode: "Take messages only" on (safe) or off (full) through set_brain_mode (service role, source admin,
 * audited in tenant_brain_mode_audit and the Admin audit). Risky: Unlock + reason.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "business id required" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { action?: string; target?: string; mode?: string; reason?: string } | null;
  const action = String(body?.action || "");
  if (!["check", "set_brain_target", "set_brain_mode"].includes(action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const stepUp = await stepUpGate(gate.operator, `business-kb:${action}`, id);
  if (stepUp) return stepUp;
  try {
    if (action === "check") {
      const r = await pingKbCompile(id, { by: "admin" }, "/internal/kb/readiness");
      if (!r.ok) return NextResponse.json({ error: "Voice did not answer. Try again in a minute." }, { status: 502 });
      await recordAdminAction({ actor: gate.operator, action: "admin.kb.readiness_checked", businessId: id, detail: { passed: (r.json as { passed?: boolean } | null)?.passed ?? null } });
      return NextResponse.json(r.json);
    }
    if (action === "set_brain_target") {
      const target = body?.target === "v1" ? "v1" : body?.target === "v2" ? "v2" : null;
      const reason = String(body?.reason || "").trim();
      if (!target) return NextResponse.json({ error: "Pick old or new brain." }, { status: 400 });
      if (reason.length < 3) return NextResponse.json({ error: "Add a reason." }, { status: 400 });
      const sb = getSupabaseAdmin();
      const { data: before } = await sb.from("tenants").select("brain_target").eq("id", id).maybeSingle();
      const { error } = await sb.from("tenants").update({ brain_target: target }).eq("id", id);
      if (error) throw error;
      await recordAdminAction({ actor: gate.operator, action: "admin.kb.brain_target", businessId: id, before: before?.brain_target ?? null, after: target, reason });
      return NextResponse.json({ ok: true, brainTarget: target });
    }
    if (action === "set_brain_mode") {
      const mode = body?.mode === "safe" ? "safe" : body?.mode === "full" ? "full" : null;
      const reason = String(body?.reason || "").trim();
      if (!mode) return NextResponse.json({ error: "Pick on or off." }, { status: 400 });
      if (reason.length < 3) return NextResponse.json({ error: "Add a reason." }, { status: 400 });
      // p_actor is a uuid; Admin operators are named, not Supabase users, so the name goes to the Admin audit.
      const r = await setBrainModeAsAdmin(id, mode, null);
      if (!r.ok) {
        const status = r.error === "not_found" ? 404 : r.error === "invalid_mode" ? 400 : r.error === "rpc_missing" ? 409 : 500;
        const words = r.error === "not_found" ? "Business not found." : r.error === "rpc_missing" ? "The brain mode SQL is not applied here yet." : "Couldn't save. Nothing changed.";
        return NextResponse.json({ error: words }, { status });
      }
      await recordAdminAction({ actor: gate.operator, action: "admin.kb.brain_mode", businessId: id, before: r.from, after: r.mode, reason });
      return NextResponse.json({ ok: true, mode: r.mode, setAt: r.setAt });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    logAdminError("business-kb", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
