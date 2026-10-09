/**
 * Platform field_path allowlist for owner attestation (GIGO).
 * Keep aligned with docs/platform/TENANT_FIELD_PROVENANCE.md.
 */

export const FIELD_PATH_PATTERNS: readonly RegExp[] = [
  /^identity\.(business_name|vertical|primary_phone|language|spoken_name|social_handles)$/,
  /^hours\.weekly_grid$/,
  /^locations\.branches$/,
  /^policies\.(payment|deposit|returns|delivery|cancellation|warranty|other|coverage_areas|holds|holds\.allowed)$/,
  /^payments\.methods$/,
  // Products: sku, else 1-based position. Services: stable id (svc_… or uuid),
  // else 1-based position (Brain's readers fall back to position).
  /^catalog\.product\..+\.(name|price)$/,
  /^catalog\.service\.[A-Za-z0-9_-]{1,64}\.(name|price|site_visit)$/,
  /^faqs\.\d+$/,
  /^team\.notify\.(whatsapp|email|channels)$/,
  /^assistant\.(agent_name|tone|language|tools)$/,
  /^bulletin\.items$/,
];

export const FIELD_PATH_ATTEST_MAX = 80;

export function isKnownFieldPath(path: string): boolean {
  const trimmed = String(path || "").trim();
  if (!trimmed) return false;
  return FIELD_PATH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Dedupe, validate, and cap attest batches. */
export function cleanFieldPaths(fieldPaths: string[], max = FIELD_PATH_ATTEST_MAX): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fieldPaths) {
    const path = String(raw || "").trim();
    if (!isKnownFieldPath(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}
