/**
 * Super Admin UI/API errors must not leak SQL files or repo paths.
 * Log the raw diagnostic with logAdminError.
 */

export const ADMIN_SETUP_INCOMPLETE = "Setup is incomplete. Contact support.";

const INTERNAL =
  /docs\/supabase|\.sql\b|row-level security|permission denied|\brls\b|schema cache|column .+ does not exist|relation .+ does not exist|function .+ does not exist|PGRST/i;

export function logAdminError(scope: string, raw: unknown): void {
  const message = raw instanceof Error ? raw.message : String(raw ?? "");
  console.error(`[admin:${scope}]`, message || raw);
}

export function adminFacingError(
  raw: unknown,
  fallback = ADMIN_SETUP_INCOMPLETE
): string {
  const message = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!message || INTERNAL.test(message)) return fallback;
  if (message.length > 180) return fallback;
  return message;
}
