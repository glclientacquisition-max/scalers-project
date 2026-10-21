import "server-only";

import {
  businessSearchHit,
  callSearchHit,
  escapeIlikeFragment,
  mergeSearchHits,
  normalizeSearchQuery,
  searchQueryReady,
  type AdminSearchHit,
} from "@/lib/adminGlobalSearchModel";
import { getSupabaseAdmin } from "@/lib/supabase";

const DEFAULT_LIMIT = 8;

/**
 * Search businesses by name or number and traced calls by id prefix.
 * Caller must gate with requireSuperAdmin or isLegacyAuthenticated.
 */
export async function adminGlobalSearch(raw: string, limit = DEFAULT_LIMIT): Promise<AdminSearchHit[]> {
  const query = normalizeSearchQuery(raw);
  if (!searchQueryReady(query)) return [];

  const admin = getSupabaseAdmin();
  const frag = escapeIlikeFragment(query);
  const pattern = `%${frag}%`;

  const cap = Math.min(limit, 6);
  const [byName, byNumber, callRes] = await Promise.all([
    admin
      .from("tenants")
      .select("id, business_name, sautikit_virtual_number")
      .ilike("business_name", pattern)
      .order("business_name", { ascending: true })
      .limit(cap),
    admin
      .from("tenants")
      .select("id, business_name, sautikit_virtual_number")
      .ilike("sautikit_virtual_number", pattern)
      .order("business_name", { ascending: true })
      .limit(cap),
    admin
      .from("calls")
      .select("id, tenant_id")
      .ilike("id", pattern)
      .order("created_at", { ascending: false })
      .limit(cap),
  ]);

  if (byName.error) throw byName.error;
  if (byNumber.error) throw byNumber.error;
  if (callRes.error) throw callRes.error;

  const bizMap = new Map<string, { id: string; business_name: string; sautikit_virtual_number: string }>();
  for (const row of [...(byName.data || []), ...(byNumber.data || [])]) {
    bizMap.set(String(row.id), {
      id: String(row.id),
      business_name: String(row.business_name || "Business"),
      sautikit_virtual_number: String(row.sautikit_virtual_number || ""),
    });
  }
  const businessHits = [...bizMap.values()]
    .toSorted((a, b) => a.business_name.localeCompare(b.business_name))
    .slice(0, cap)
    .map((row) => businessSearchHit(row));

  const callRows = (callRes.data || []) as Array<{ id: string; tenant_id: string }>;
  const tenantIds = [...new Set(callRows.map((row) => String(row.tenant_id)))];
  const names = new Map<string, string>();
  if (tenantIds.length) {
    const { data: tenants } = await admin.from("tenants").select("id, business_name").in("id", tenantIds);
    for (const row of tenants || []) {
      names.set(String(row.id), String(row.business_name || ""));
    }
  }

  const callHits = callRows.map((row) =>
    callSearchHit({ id: String(row.id), business_name: names.get(String(row.tenant_id)) }),
  );

  return mergeSearchHits(businessHits, callHits, limit);
}
