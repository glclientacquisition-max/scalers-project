/**
 * Maps one v0 tenant_area_picks row (jsonb `picks` document) to v1 row-shaped inserts.
 * Parity with docs/supabase/tenant_area_picks_to_rows.sql (staging cutover).
 *
 * v0 `picks` column (Desk saveAreaPicks): AreaPicks document
 *   { version: 1, tree_version?: string, picks: AreaPick[] }
 * Each array element:
 *   node (string, required)
 *   serve (boolean, default true when absent; only JSON false excludes)
 *   fee_kes (number | string, optional; fee_ksh accepted for legacy migrate parity)
 *   note (string, optional; cleared when serve is false)
 */

const AREA_FEE_MAX = 100_000;
const AREA_NOTE_MAX = 200;

export type V0TenantAreaPicksRow = {
  tenant_id: string;
  tree_version: string | null;
  picks: unknown;
  moved_from: unknown;
  confirmed_at: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type TenantAreaPickRow = {
  tenant_id: string;
  node: string;
  serve: boolean;
  fee_kes: number | null;
  note: string | null;
  confirmed_at: string | null;
  tree_version: string;
  moved_from: unknown;
  updated_by: string | null;
  updated_at: string;
};

function pickArray(doc: unknown): unknown[] {
  if (!doc || typeof doc !== "object") return [];
  const o = doc as Record<string, unknown>;
  if (Array.isArray(o.picks)) return o.picks;
  if (Array.isArray(doc)) return doc;
  return [];
}

function serveFromPick(raw: Record<string, unknown>): boolean {
  return raw.serve !== false;
}

function cleanFee(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw.replace(/[, ]/g, ""))
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), AREA_FEE_MAX);
}

function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, AREA_NOTE_MAX);
  return t || null;
}

function feeFromPick(raw: Record<string, unknown>, serve: boolean): number | null {
  if (!serve) return null;
  const rawFee = raw.fee_kes ?? raw.fee_ksh;
  return cleanFee(rawFee);
}

function treeVersionFromRow(row: V0TenantAreaPicksRow): string {
  const fromCol = row.tree_version?.trim();
  if (fromCol) return fromCol;
  const doc = row.picks && typeof row.picks === "object" ? (row.picks as Record<string, unknown>) : null;
  const fromDoc = typeof doc?.tree_version === "string" ? doc.tree_version.trim() : "";
  if (fromDoc) return fromDoc;
  return "ke-areas-2026-10-24.1";
}

/** One output row per pick in the v0 jsonb document (last duplicate node wins, same as Desk normalize order). */
export function rowsFromV0TenantRow(row: V0TenantAreaPicksRow): TenantAreaPickRow[] {
  const tree_version = treeVersionFromRow(row);
  const byNode = new Map<string, TenantAreaPickRow>();
  for (const p of pickArray(row.picks)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const node = typeof o.node === "string" ? o.node.trim() : "";
    if (!node) continue;
    const serve = serveFromPick(o);
    byNode.set(node, {
      tenant_id: row.tenant_id,
      node,
      serve,
      fee_kes: feeFromPick(o, serve),
      note: serve ? cleanNote(o.note) : null,
      confirmed_at: row.confirmed_at,
      tree_version,
      moved_from: row.moved_from,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    });
  }
  return [...byNode.values()];
}
