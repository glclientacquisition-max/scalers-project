import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { emptyAreaPicks, moveOverAreas, normalizeAreaPicks, type AreaPicks } from "@/lib/areaPicks";
import {
  applyCoverageMirrorToPolicies,
  applyCoverageMirrorToServiceAreas,
  areaPicksToCoverageAreas,
} from "@/lib/areaPicksToCoverageAreas";
import { writeAreaPickRows, type AreaPickRow, type PicksClient } from "@/lib/areaPicksWrite";
import { bustTenantCache } from "@/lib/tenantCache";

export type AreaPicksRow = { picks: AreaPicks; confirmed_at: string | null; moved_from: string[] | null };
export type AreaPicksLoad = { ok: true; row: AreaPicksRow | null } | { ok: false; error: string };

type PickRow = {
  node: string;
  serve: boolean;
  fee_kes: number | null;
  note: string | null;
  confirmed_at: string | null;
  tree_version: string;
  moved_from: unknown;
};

function movedFromList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is string => typeof x === "string");
  return out.length ? out : null;
}

export async function loadAreaPicks(tenantId: string): Promise<AreaPicksLoad> {
  const res = await getSupabaseAdmin()
    .from("tenant_area_picks")
    .select("node, serve, fee_kes, note, confirmed_at, tree_version, moved_from")
    .eq("tenant_id", tenantId);
  if (res.error) return { ok: false, error: res.error.message };
  const rows = (res.data || []) as PickRow[];
  if (!rows.length) return { ok: true, row: null };
  const tree_version = rows[0].tree_version;
  const confirmed_at = rows.find((r) => r.confirmed_at)?.confirmed_at ?? null;
  const moved = movedFromList(rows.find((r) => r.moved_from != null)?.moved_from);
  const picks: AreaPicks = normalizeAreaPicks({
    version: 1,
    tree_version,
    picks: rows.map((r) => ({
      node: r.node,
      serve: r.serve !== false,
      fee_kes: r.fee_kes,
      note: r.note,
    })),
  });
  return { ok: true, row: { picks, confirmed_at, moved_from: moved } };
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
  const existing = await loadAreaPicks(tenantId);
  const confirmed_at =
    opts.confirm ? new Date().toISOString() : existing.ok && existing.row ? existing.row.confirmed_at : null;
  const moved_from = opts.movedFrom ?? (existing.ok && existing.row ? existing.row.moved_from : null);
  const now = new Date().toISOString();
  const rows: AreaPickRow[] = clean.picks.map((p) => ({
    tenant_id: tenantId,
    node: p.node,
    serve: p.serve,
    fee_kes: p.fee_kes,
    note: p.note,
    confirmed_at,
    tree_version: clean.tree_version,
    moved_from: moved_from?.length ? moved_from : null,
    updated_at: now,
    updated_by: opts.userId ?? null,
  }));
  // Upsert then prune (lib/areaPicksWrite.ts): a failed write leaves the old picks in place.
  const written = await writeAreaPickRows(getSupabaseAdmin() as unknown as PicksClient, tenantId, rows);
  if (!written.ok) return { ok: false, error: written.error };
  const priorPicks = existing.ok && existing.row ? existing.row.picks : null;
  return mirrorCoverageFromPicks(tenantId, clean, Boolean(confirmed_at), priorPicks);
}

/**
 * Compat for prod Voice (no tenant_area_picks reader): write the same picks into
 * business_policies.coverage_areas / coverage_outside and service_areas terms
 * (lib/areaPicksToCoverageAreas.ts). Compare-and-set on business_policies so a
 * Policies save in between is never overwritten.
 */
export async function mirrorCoverageFromPicks(
  tenantId: string,
  picks: AreaPicks,
  confirmed: boolean,
  /** Picks before this save; null = no row yet (then the old list the page showed, moved over). */
  priorPicks: AreaPicks | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin
      .from("tenants")
      .select("business_policies, service_areas, vertical")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "tenant not found" };
    const mirror = areaPicksToCoverageAreas(picks, {
      confirmed,
      vertical: (data as { vertical?: string | null }).vertical ?? null,
      priorServiceAreas: data.service_areas,
      priorCoverage: (data.business_policies as { coverage_areas?: unknown } | null)?.coverage_areas,
      priorPicks: priorPicks ?? moveOverAreas(oldCoverageList(data)).picks,
    });
    if (mirror.unmapped.length || mirror.lossy.length || mirror.overflow || mirror.dropped.length) {
      console.warn(
        `[area_picks] coverage mirror tenant=${tenantId} unmapped=${mirror.unmapped.length} lossy=${mirror.lossy.length} overflow=${mirror.overflow} kept=${mirror.kept.length} dropped=${mirror.dropped.length}`,
      );
    }
    const before = data.business_policies ?? null;
    let q = admin
      .from("tenants")
      .update({
        business_policies: applyCoverageMirrorToPolicies(before, mirror),
        service_areas: applyCoverageMirrorToServiceAreas(data.service_areas, mirror),
      })
      .eq("id", tenantId);
    q = before == null ? q.is("business_policies", null) : q.eq("business_policies", JSON.stringify(before));
    const upd = await q.select("id");
    if (upd.error) return { ok: false, error: upd.error.message };
    if ((upd.data ?? []).length === 1) {
      bustTenantCache(tenantId);
      return { ok: true };
    }
  }
  return { ok: false, error: "changed while saving" };
}

/**
 * The old list the owner still has to check: the moved_from list once a picks row exists
 * (the mirror rewrites coverage_areas on every save), else the legacy coverage fields.
 */
export function pendingOldList(
  tenant: { service_areas?: unknown; business_policies?: unknown },
  row: AreaPicksRow | null,
): string[] {
  if (row) return row.moved_from ?? [];
  return oldCoverageList(tenant);
}

export { emptyAreaPicks, moveOverAreas };
