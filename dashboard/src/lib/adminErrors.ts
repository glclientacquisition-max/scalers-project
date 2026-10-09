/**
 * Super Admin UI/API errors must not leak SQL files or repo paths.
 * Log the raw diagnostic with logAdminError.
 */

export const ADMIN_SETUP_INCOMPLETE = "Setup is incomplete. Contact support.";

const INTERNAL =
  /docs\/supabase|\.sql\b|row-level security|permission denied|\brls\b|schema cache|column .+ does not exist|relation .+ does not exist|function .+ does not exist|PGRST/i;

/** PostgREST "table not in schema cache" and Postgres "undefined_table". */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const MISSING_TABLE_TEXT = /relation .+ does not exist|could not find the table/i;

export type AdminErrorParts = { message: string; code: string | null };

/**
 * Message and code from an Error, a plain PostgREST/Supabase error object
 * ({ message, code, details, hint } — not an Error instance), or anything else.
 */
export function adminErrorParts(raw: unknown): AdminErrorParts {
  if (raw && typeof raw === "object") {
    const { message, code } = raw as { message?: unknown; code?: unknown };
    const text = typeof message === "string" ? message : "";
    const codeText = typeof code === "string" && code ? code : typeof code === "number" ? String(code) : null;
    if (text || codeText || raw instanceof Error) return { message: text, code: codeText };
    try {
      return { message: JSON.stringify(raw), code: null };
    } catch {
      return { message: String(raw), code: null };
    }
  }
  return { message: String(raw ?? ""), code: null };
}

export function isMissingTableError(raw: unknown): boolean {
  const { message, code } = adminErrorParts(raw);
  return (code !== null && MISSING_TABLE_CODES.has(code)) || MISSING_TABLE_TEXT.test(message);
}

export function logAdminError(scope: string, raw: unknown): void {
  const { message, code } = adminErrorParts(raw);
  const line = code ? `${message || "(no message)"} [${code}]` : message;
  console.error(`[admin:${scope}]`, line || raw);
}

/**
 * Postgres/PostgREST codes that are never safe or useful to show an operator:
 * 42xxx (syntax, ambiguous/undefined column, permission), XX (internal),
 * 08 (connection) and PGRST (API/schema cache).
 */
const INTERNAL_CODE = /^(42|XX|08|PGRST)/i;

/**
 * One plain sentence for the Admin UI. Accepts an Error, a plain
 * PostgREST/Supabase error object ({ message, code, details, hint }) or a
 * string. Never returns "[object Object]", SQL file paths or raw SQL errors;
 * RAISE EXCEPTION text from our RPCs (P0001, e.g. "tenant not found") is kept.
 */
export function adminFacingError(
  raw: unknown,
  fallback = ADMIN_SETUP_INCOMPLETE
): string {
  if (raw && typeof raw === "object" && !(raw instanceof Error)) {
    const { message: m, code: c } = raw as { message?: unknown; code?: unknown };
    if (typeof m !== "string" && c == null) return fallback;
  }
  const { message: text, code } = adminErrorParts(raw);
  const message = text.trim();
  if (code && INTERNAL_CODE.test(code)) return fallback;
  if (!message || INTERNAL.test(message) || /\bambiguous\b|\[object Object\]/i.test(message)) return fallback;
  if (message.length > 180) return fallback;
  return message.charAt(0).toUpperCase() + message.slice(1);
}
