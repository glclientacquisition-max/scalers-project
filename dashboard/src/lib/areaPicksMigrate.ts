/**
 * One-time backfill: legacy coverage lists -> tenant_area_picks (unconfirmed).
 * Used by scripts/backfill-tenant-area-picks.js and docs/supabase/tenant_area_picks_backfill.sql tests.
 */
import { AREA_TREE_VERSION, emptyAreaPicks, moveOverAreas, normalizeAreaPicks, setAreaDetail, type AreaPicks } from "./areaPicks.ts";

type LegacyArea = {
  id?: string;
  serve?: boolean;
  fee_ksh?: number | null;
  fee_kes?: number | null;
  note?: string | null;
};

export type LegacyTenantAreas = {
  service_areas?: { areas?: LegacyArea[]; anywhere_kenya?: boolean; outside_fee_ksh?: number | null } | null;
  business_policies?: {
    coverage_areas?: string[] | null;
    coverage_outside?: { anywhere_kenya?: boolean; fee_ksh?: number | null } | null;
  } | null;
};

function legacyIds(tenant: LegacyTenantAreas): string[] {
  const out: string[] = [];
  const sa = tenant.service_areas;
  if (sa && Array.isArray(sa.areas)) {
    for (const a of sa.areas) if (typeof a?.id === "string") out.push(a.id);
  }
  const cov = tenant.business_policies?.coverage_areas;
  if (Array.isArray(cov)) for (const c of cov) if (typeof c === "string") out.push(c);
  return [...new Set(out)];
}

function feeKes(area: LegacyArea): number | null {
  const n = area.fee_kes ?? area.fee_ksh;
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : Number(String(n).replace(/[, ]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** Build picks JSON + moved_from for a tenant row. confirmed_at stays null (owner checks on Desk). */
export function tenantAreaPicksFromLegacy(tenant: LegacyTenantAreas): {
  tree_version: string;
  picks: AreaPicks;
  moved_from: string[];
} {
  const moved_from = legacyIds(tenant);
  const moved = moveOverAreas(moved_from);
  let picks = moved.picks;

  const sa = tenant.service_areas;
  if (sa && Array.isArray(sa.areas)) {
    for (const area of sa.areas) {
      if (!area || typeof area.id !== "string") continue;
      const node = moved.rows.find((r) => r.raw === area.id.replace(/^(county|place):/, ""))?.node
        ?? moved.rows.find((r) => r.raw === area.id)?.node;
      if (!node) continue;
      picks = setAreaDetail(picks, node, {
        serve: area.serve !== false,
        fee_kes: feeKes(area),
        note: area.note ?? null,
      });
    }
  }

  const outside =
    tenant.business_policies?.coverage_outside?.anywhere_kenya === true || sa?.anywhere_kenya === true;
  const outsideFee =
    tenant.business_policies?.coverage_outside?.fee_ksh ?? sa?.outside_fee_ksh ?? null;
  if (outside) {
    const n = outsideFee == null ? null : Number(String(outsideFee).replace(/[, ]/g, ""));
    picks = setAreaDetail(picks, "ke", {
      serve: true,
      fee_kes: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
      note: null,
    });
  }

  const clean = normalizeAreaPicks(picks.picks.length ? picks : emptyAreaPicks());
  return { tree_version: AREA_TREE_VERSION, picks: clean, moved_from };
}
