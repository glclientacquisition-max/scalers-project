import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { emptyAreaPicks, moveOverAreas, normalizeAreaPicks, type AreaPicks } from "@/lib/areaPicks";

export type AreaPicksRow = { picks: AreaPicks; confirmed_at: string | null; updated_at: string | null; moved_from: string[] | null };
export type AreaPicksLoad = { ok: true; row: AreaPicksRow | null } | { ok: false; error: string };

export async function loadAreaPicks(tenantId: string): Promise<AreaPicksLoad> {
  const res = await getSupabaseAdmin()
    .from("tenant_area_picks")
    .select("picks, confirmed_at, updated_at, moved_from")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (res.error) return { ok: false, error: res.error.message };
  if (!res.data) return { ok: true, row: null };
  const moved = Array.isArray(res.data.moved_from) ? (res.data.moved_from as unknown[]).filter((x): x is string => typeof x === "string") : null;
  return { ok: true, row: { picks: normalizeAreaPicks(res.data.picks), confirmed_at: res.data.confirmed_at ?? null, updated_at: res.data.updated_at ?? null, moved_from: moved } };
}

/** The old Locations areas and policy coverage list, as directory ids or names. */
export function oldCoverageList(tenant: { service_areas?: unknown; business_policies?: unknown }): string[] {
  const out: string[] = [];
  const sa = tenant.service_areas as { areas?: Array<{ id?: unknown }> } | null | undefined;
  if (sa && Array.isArray(sa.areas)) for (const a of sa.areas) if (typeof a?.id === "string") out.push(a.id);
  const bp = tenant.business_policies as { coverage_areas?: unknown } | null | undefined;
  if (bp && Array.isArray(bp.coverage_areas)) for (const c of bp.coverage_areas) if (typeof c === "string") out.push(c);
  return [...new Set(out)];
}

export async function saveAreaPicks(
  tenantId: string,
  picks: AreaPicks,
  opts: { confirm?: boolean; movedFrom?: string[] | null; userId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeAreaPicks(picks);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    tree_version: clean.tree_version,
    picks: clean,
    updated_at: now,
    updated_by: opts.userId ?? null,
  };
  // Same stamp as updated_at, so the row reads "confirmed", not "edited since confirm".
  if (opts.confirm) row.confirmed_at = now;
  if (opts.movedFrom) row.moved_from = opts.movedFrom;
  const res = await getSupabaseAdmin().from("tenant_area_picks").upsert(row, { onConflict: "tenant_id" });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: true };
}

export { emptyAreaPicks, moveOverAreas };
