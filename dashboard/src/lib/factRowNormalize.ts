/**
 * One normal form for the fact columns of a tenants row, so a changed-only
 * confirm compares like with like. The stored row ahead of a Settings save is
 * raw (seed and import rows keep camelCase keys, string flags, nameless rows);
 * the saved row went through these same parsers on the way in. Diffing the raw
 * row against the parsed one made every catalogue row look changed (D1).
 *
 * Diff only. The confirm hash is still taken from the stored row as saved.
 * Columns not present on the row are left out, never invented.
 */

import { normalizeServicesCatalog } from "@/lib/servicesCatalog";
import { normalizeProductCatalog } from "@/lib/productCatalog";
import { normalizeSocialHandles } from "@/lib/socialHandles";
import { parseHoursSchedule } from "@/lib/hoursSchedule";
import { normalizeBusinessLocations } from "@/lib/businessLocations";
import { normalizeBusinessPolicies } from "@/lib/businessPolicies";
import { parseAgentTools } from "@/lib/agentTools";
import { parseVertical } from "@/lib/vertical";
import { canonicalizeAgentTone } from "@/lib/onboarding";

type Row = Record<string, unknown>;

const has = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key);

/** Same parsers saveAndCompileSettings applies to the stored side of each field. */
const COLUMN_NORMALIZERS: Record<string, (raw: unknown) => unknown> = {
  services_catalog: (raw) => normalizeServicesCatalog(raw).filter((row) => row.name),
  product_catalog: (raw) => normalizeProductCatalog(raw).filter((row) => row.name),
  social_handles: (raw) => normalizeSocialHandles(raw ?? {}),
  hours_schedule: (raw) => parseHoursSchedule(raw),
  business_locations: (raw) => normalizeBusinessLocations(raw ?? []),
  business_policies: (raw) => normalizeBusinessPolicies(raw ?? {}),
  agent_tools: (raw) => parseAgentTools(raw),
  vertical: (raw) => parseVertical(raw),
  agent_tone: (raw) => canonicalizeAgentTone(String(raw ?? "")),
  agent_name: (raw) => String(raw ?? "").trim() || "Receptionist",
};

export function normalizeFactRow(row: Row | null | undefined): Row {
  const src = row && typeof row === "object" ? row : {};
  const out: Row = { ...src };
  for (const [column, normalize] of Object.entries(COLUMN_NORMALIZERS)) {
    if (has(src, column)) out[column] = normalize(src[column]);
  }
  return out;
}
