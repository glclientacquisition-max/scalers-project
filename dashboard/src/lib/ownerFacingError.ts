/**
 * Owner-facing errors must name the next action, not SQL files or RLS internals.
 * Log the raw diagnostic with logDeskError.
 */

const SQL_HINT =
  /\s*Apply\s+docs\/supabase\/[\w./-]+\.sql(?:\s+\([^)]*\))?(?:\s+in Supabase)?(?:\s+if (?:you have not yet|needed))?\.?/gi;

const INTERNAL =
  /row-level security|permission denied|\brls\b|schema cache|column .+ does not exist|relation .+ does not exist|PGRST/i;

/** Production React replaces the real message with a decoder URL. Never show that. */
const MINIFIED_REACT =
  /minified react error #\d+|react\.dev\/errors\/\d+|reactjs\.org\/docs\/error-decoder\.html/i;

export function logDeskError(scope: string, raw: unknown): void {
  const message = raw instanceof Error ? raw.message : String(raw ?? "");
  console.error(`[desk:${scope}]`, message || raw);
}

export function ownerFacingError(raw: unknown, fallback: string): string {
  const message = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!message || MINIFIED_REACT.test(message)) return fallback;

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

/** Owner copy when a review-queue write fails. Loading an empty queue is not a write. */
export function pronunciationWriteError(
  kind: "listen" | "review",
  raw: unknown
): string {
  const fallback =
    kind === "listen" ? "Could not save the listen." : "Could not save the review.";
  return ownerFacingError(raw, fallback);
}

export function ownerSaveFailed(
  scope: string,
  raw: unknown,
  fallback = "Could not save."
): { error: string } {
  logDeskError(scope, raw);
  return { error: ownerFacingError(raw, fallback) };
}
