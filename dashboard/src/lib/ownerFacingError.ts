/**
 * Owner-facing errors must name the next action, not SQL files or RLS internals.
 * Log the raw diagnostic with logDeskError.
 */

const SQL_HINT =
  /\s*Apply\s+docs\/supabase\/[\w./-]+\.sql(?:\s+\([^)]*\))?(?:\s+in Supabase)?(?:\s+if (?:you have not yet|needed))?\.?/gi;

const INTERNAL =
  /row-level security|permission denied|\brls\b|schema cache|column .+ does not exist|relation .+ does not exist|PGRST/i;

export function logDeskError(scope: string, raw: unknown): void {
  const message = raw instanceof Error ? raw.message : String(raw ?? "");
  console.error(`[desk:${scope}]`, message || raw);
}

export function ownerFacingError(raw: unknown, fallback: string): string {
  const message = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!message) return fallback;

  const stripped = message
    .replace(SQL_HINT, "")
    .replace(/\s+in Supabase\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.]+$/, ".");

  if (!stripped || INTERNAL.test(stripped) || stripped === ".") {
    return fallback;
  }

  if (stripped.length > 180 || /docs\/supabase/i.test(stripped)) {
    return fallback;
  }

  return stripped;
}

export function ownerSaveFailed(
  scope: string,
  raw: unknown,
  fallback = "Could not save."
): { error: string } {
  logDeskError(scope, raw);
  return { error: ownerFacingError(raw, fallback) };
}
