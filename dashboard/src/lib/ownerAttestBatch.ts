/**
 * Owner attest (FACT_HASH_MODE off, the P0 "Save is the owner's approval"
 * path) as a fixed number of round trips, however many fields a save touched:
 *
 *   1 read of the saved fact row
 *   1 tenants UPDATE that stamps owner on every JSON row (catalogue, FAQs, policies)
 *   1 confirm_tenant_fields batch RPC for every path
 *
 * Before: per path, confirm_tenant_field (+ upsert_tenant_field_meta on error)
 * and a full read + rewrite of product_catalog/services_catalog/faqs/
 * business_policies. Up to 80 paths, so up to ~240 sequential queries and 80
 * whole-column rewrites, each able to overwrite a save that landed meanwhile.
 *
 * Pure apart from the injected deps, so node tests can count round trips.
 */
import { factValueForPath, hashFactValue } from "./factHash";

type Row = Record<string, unknown>;

const PRODUCT_PATH = /^catalog\.product\.(.+)\.name$/;
const SERVICE_PATH = /^catalog\.service\.(\d+)\.name$/;
const FAQ_PATH = /^faqs\.(\d+)/;
const POLICY_PATH = /^policies\.(payment|deposit|returns|delivery|cancellation|warranty|other)$/;

/** Columns a JSON owner stamp can touch. */
export const OWNER_STAMP_COLUMNS = ["product_catalog", "services_catalog", "faqs", "business_policies"] as const;
export type OwnerStampColumn = (typeof OWNER_STAMP_COLUMNS)[number];

/** True when the path has a JSON row to stamp (else meta only). */
export function ownerStampApplies(fieldPath: string): boolean {
  return [PRODUCT_PATH, SERVICE_PATH, FAQ_PATH, POLICY_PATH].some((re) => re.test(fieldPath));
}

function list(raw: unknown): Row[] {
  return Array.isArray(raw) ? [...(raw as Row[])] : [];
}

/**
 * Stamp one path on a working copy (same rules persistOwnerConfirm always
 * used). Returns false when the path names no row.
 */
function stampOne(work: Row, fieldPath: string, touched: Set<OwnerStampColumn>): boolean {
  const product = fieldPath.match(PRODUCT_PATH);
  const service = fieldPath.match(SERVICE_PATH);
  const faq = fieldPath.match(FAQ_PATH);
  const policy = fieldPath.match(POLICY_PATH);
  if (product) {
    const key = product[1];
    let hit = false;
    const rows = list(work.product_catalog).map((row, index) => {
      const sku = String(row?.sku || "").trim() || String(index + 1);
      if (sku !== key && String(index + 1) !== key) return row;
      hit = true;
      return { ...row, source: "owner" };
    });
    if (!hit) return false;
    work.product_catalog = rows;
    touched.add("product_catalog");
    return true;
  }
  if (service) {
    const index = Number(service[1]) - 1;
    const rows = list(work.services_catalog);
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    rows[index] = { ...row, source: "owner" };
    work.services_catalog = rows;
    touched.add("services_catalog");
    return true;
  }
  if (faq) {
    const index = Number(faq[1]) - 1;
    const rows = list(work.faqs);
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    const prevStatus = String(row.status || "").toLowerCase();
    rows[index] = {
      ...row,
      source: "owner",
      status: prevStatus === "golden" ? "golden" : "confirmed",
      confirmed: true,
    };
    work.faqs = rows;
    touched.add("faqs");
    return true;
  }
  if (policy) {
    const key = policy[1];
    const current =
      work.business_policies && typeof work.business_policies === "object" && !Array.isArray(work.business_policies)
        ? (work.business_policies as Row)
        : {};
    const prev =
      current.provenance && typeof current.provenance === "object" && !Array.isArray(current.provenance)
        ? (current.provenance as Row)
        : {};
    work.business_policies = { ...current, provenance: { ...prev, [key]: { source: "owner", confirmed: true } } };
    touched.add("business_policies");
    return true;
  }
  return false;
}

/**
 * One patch that stamps owner on every path's JSON row, applied in order on
 * one copy. Null when no path has a JSON row.
 */
export function ownerStampPatch(row: Row, fieldPaths: string[]): Partial<Record<OwnerStampColumn, unknown>> | null {
  const work: Row = {};
  for (const column of OWNER_STAMP_COLUMNS) work[column] = row[column];
  const touched = new Set<OwnerStampColumn>();
  for (const path of fieldPaths) stampOne(work, path, touched);
  if (!touched.size) return null;
  const patch: Partial<Record<OwnerStampColumn, unknown>> = {};
  for (const column of touched) patch[column] = work[column];
  return patch;
}

/**
 * Paths and hashes for one confirm_tenant_fields call. The hash is the saved
 * value's fact hash (what confirm v2 expects). With FACT_HASH_MODE off,
 * readers ignore value_hash and read source = owner, exactly as before.
 */
export function ownerAttestBatch(row: Row, fieldPaths: string[]): { paths: string[]; hashes: string[] } {
  const paths: string[] = [];
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const path of fieldPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    hashes.push(hashFactValue(factValueForPath(path, row) ?? null));
  }
  return { paths, hashes };
}

export type OwnerAttestDeps = {
  /** The saved fact row (FACT_ROW_COLUMNS). Null on a read error. */
  readRow: () => Promise<Row | null>;
  /** One tenants UPDATE. */
  writePatch: (patch: Partial<Record<OwnerStampColumn, unknown>>) => Promise<{ error: unknown }>;
  /** One confirm_tenant_fields RPC (all or nothing). */
  confirmBatch: (paths: string[], hashes: string[]) => Promise<{ error: unknown }>;
  /** The old per-path confirm (confirm_tenant_field, else upsert meta). Only when the batch fails. */
  confirmOne: (path: string) => Promise<void>;
};

export type OwnerAttestRun = {
  stamped: boolean;
  batched: boolean;
  fallbackPaths: number;
};

export async function runOwnerAttest(deps: OwnerAttestDeps, fieldPaths: string[]): Promise<OwnerAttestRun> {
  const out: OwnerAttestRun = { stamped: false, batched: false, fallbackPaths: 0 };
  if (!fieldPaths.length) return out;
  const row = await deps.readRow();
  if (row) {
    // Stamp first, right after the read, so the read-modify-write window is one round trip.
    const patch = ownerStampPatch(row, fieldPaths);
    if (patch) {
      const { error } = await deps.writePatch(patch);
      out.stamped = !error;
    }
    const batch = ownerAttestBatch(row, fieldPaths);
    const { error } = await deps.confirmBatch(batch.paths, batch.hashes);
    out.batched = !error;
    if (out.batched) return out;
  }
  // No v2 batch RPC on this database (or the read failed): the old per-path
  // meta confirm, without the per-path column rewrites.
  for (const path of fieldPaths) {
    try {
      await deps.confirmOne(path);
    } catch {
      /* local database without RPC */
    }
    out.fallbackPaths += 1;
  }
  return out;
}
