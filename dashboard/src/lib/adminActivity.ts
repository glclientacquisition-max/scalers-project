import { requireSuperAdmin } from "@/lib/adminGuard";
import type { ActivityRow } from "@/lib/adminActivityModel";
import { getSupabaseAdmin } from "@/lib/supabase";

export const ACTIVITY_LIMIT = 100;

/**
 * Newest admin actions first, optionally for one business and/or one operator.
 * Also the business names and the operators seen recently, for the filters. Reads only.
 */
export async function loadAdminActivity(filters: { business: string | null; actor: string | null }): Promise<{
  rows: ActivityRow[];
  businesses: { id: string; name: string }[];
  actors: string[];
}> {
  await requireSuperAdmin();
  const db = getSupabaseAdmin();
  let query = db
    .from("ops_audit_log")
    .select("id, created_at, actor, action, tenant_id, amount_kes, detail")
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  if (filters.business) query = query.eq("tenant_id", filters.business);
  if (filters.actor) query = query.eq("actor", filters.actor);

  const [rowsRes, tenantsRes, actorsRes] = await Promise.all([
    query,
    db.from("tenants").select("id, business_name").order("business_name", { ascending: true }),
    db.from("ops_audit_log").select("actor").order("created_at", { ascending: false }).limit(500),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  if (tenantsRes.error) throw tenantsRes.error;
  if (actorsRes.error) throw actorsRes.error;

  const actors = [...new Set((actorsRes.data || []).map((r: { actor: string | null }) => String(r.actor || "").trim()))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return {
    rows: (rowsRes.data || []).map((r) => ({
      id: String(r.id),
      created_at: String(r.created_at),
      actor: String(r.actor || ""),
      action: String(r.action || ""),
      tenant_id: r.tenant_id ? String(r.tenant_id) : null,
      amount_kes: r.amount_kes != null ? Number(r.amount_kes) : null,
      detail: (r.detail as Record<string, unknown>) ?? null,
    })),
    businesses: (tenantsRes.data || []).map((t: { id: string; business_name: string | null }) => ({
      id: String(t.id),
      name: String(t.business_name || "Unnamed business"),
    })),
    actors,
  };
}
