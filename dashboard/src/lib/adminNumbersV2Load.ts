import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import type { MoveTarget, NumberRow, WaitingBusiness } from "@/lib/ops/numbersView";

type Raw = {
  id: string; created_at: string; e164: string; status: string; tenant_id: string | null; assigned_at: string | null;
  notes: string | null; quarantine_until?: string | null; quarantined_at?: string | null; last_tenant_id?: string | null; winback_hold?: boolean | null;
};
const BASE = "id, created_at, e164, status, tenant_id, assigned_at, notes";
const HOLD = ", quarantine_until, quarantined_at, last_tenant_id";
const WINBACK = ", winback_hold";

/** Numbers v2 (ADMIN_V2). Read-only. Hold / win-back columns are optional so an older schema still loads. */
export async function loadNumbersV2(): Promise<{ rows: NumberRow[]; waiting: WaitingBusiness[]; targets: MoveTarget[] }> {
  const admin = getSupabaseAdmin();
  let data: unknown[] | null = null;
  const withWinback = await admin.from("sautikit_did_pool").select(BASE + HOLD + WINBACK).order("e164");
  if (!withWinback.error) {
    data = withWinback.data;
  } else {
    const withHold = await admin.from("sautikit_did_pool").select(BASE + HOLD).order("e164");
    if (!withHold.error) {
      data = withHold.data;
    } else {
      const base = await admin.from("sautikit_did_pool").select(BASE).order("e164");
      if (base.error) throw base.error;
      data = base.data;
    }
  }
  const raw = (data || []) as unknown as Raw[];

  const waitingQ = await admin
    .from("tenants")
    .select("id, business_name, created_at")
    .like("sautikit_virtual_number", "pending:%")
    .order("created_at", { ascending: true });
  if (waitingQ.error) throw waitingQ.error;

  const ids = [...new Set(raw.flatMap((r) => [r.tenant_id, r.last_tenant_id]).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, { name: string; active: boolean | null }>();
  if (ids.length) {
    const t = await admin.from("tenants").select("id, business_name, is_active").in("id", ids);
    if (t.error) throw t.error;
    for (const x of (t.data || []) as { id: string; business_name: string | null; is_active: boolean | null }[]) {
      names.set(String(x.id), { name: x.business_name || "Unnamed business", active: x.is_active });
    }
  }

  const rows: NumberRow[] = raw.map((r) => ({
    id: r.id,
    e164: r.e164,
    status: r.status,
    businessId: r.tenant_id,
    businessName: r.tenant_id ? names.get(String(r.tenant_id))?.name ?? null : null,
    businessActive: r.tenant_id ? names.get(String(r.tenant_id))?.active ?? null : null,
    assignedAt: r.assigned_at,
    createdAt: r.created_at,
    notes: r.notes,
    holdUntil: r.quarantine_until ?? null,
    heldAt: r.quarantined_at ?? null,
    lastBusinessId: r.last_tenant_id ?? null,
    lastBusinessName: r.last_tenant_id ? names.get(String(r.last_tenant_id))?.name ?? null : null,
    winbackHold: Boolean(r.winback_hold),
  }));
  const waiting = ((waitingQ.data || []) as { id: string; business_name: string | null; created_at: string }[]).map((t) => ({
    id: t.id,
    name: t.business_name || "Unnamed business",
    since: t.created_at,
  }));
  return { rows, waiting, targets: await loadMoveTargets() };
}

/**
 * Businesses a number can move to: active, not archived, not suspended, no live line.
 * Best effort: a failure leaves Move with an empty list (it says why) instead of breaking Numbers.
 */
async function loadMoveTargets(): Promise<MoveTarget[]> {
  const q = await getSupabaseAdmin()
    .from("tenants")
    .select("id, business_name, sautikit_virtual_number, suspended_at")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("business_name", { ascending: true })
    .limit(500);
  if (q.error) return [];
  return ((q.data || []) as { id: string; business_name: string | null; sautikit_virtual_number: string | null; suspended_at: string | null }[])
    .filter((t) => !t.suspended_at && (!t.sautikit_virtual_number || /^pending:/i.test(t.sautikit_virtual_number)))
    .map((t) => ({ id: String(t.id), name: t.business_name || "Unnamed business" }));
}
