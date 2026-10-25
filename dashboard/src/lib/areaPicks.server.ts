import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { emptyAreaPicks, moveOverAreas, normalizeAreaPicks, type AreaPicks } from "@/lib/areaPicks";

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
  const admin = getSupabaseAdmin();
  const del = await admin.from("tenant_area_picks").delete().eq("tenant_id", tenantId);
  if (del.error) return { ok: false, error: del.error.message };
  if (!clean.picks.length) return { ok: true };
  const payload = clean.picks.map((p) => ({
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
  const res = await admin.from("tenant_area_picks").insert(payload);
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: true };
}

export { emptyAreaPicks, moveOverAreas };
