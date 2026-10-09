/**
 * Super Admin UI/API errors must not leak SQL files, repo paths, or supplier,
 * vendor, and infra names. Log the raw diagnostic with logAdminError.
 */

export const ADMIN_SETUP_INCOMPLETE = "Setup is incomplete. Contact support.";

const INTERNAL =
  /docs\/supabase|\.sql\b|row-level security|permission denied|\brls\b|schema cache|column .+ does not exist|relation .+ does not exist|function .+ does not exist|PGRST|is ambiguous|violates .+ constraint|syntax error|invalid input syntax|\[object Object\]|^\s*[{[]/i;

/**
 * A database error code other than a deliberate `raise exception` (P0001) is a fault, not
 * something the operator can act on. Show the fallback and keep the detail in the log.
 */
function isFaultCode(code: string | null): boolean {
  if (!code) return false;
  if (code === "P0001") return false;
  return /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
}

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

export function adminFacingError(
  raw: unknown,
  fallback = ADMIN_SETUP_INCOMPLETE
): string {
  const parts = adminErrorParts(raw);
  const message = parts.message.trim();
  if (!message || isFaultCode(parts.code) || INTERNAL.test(message) || hasVendorOrInfraName(message)) return fallback;
  if (message.length > 180) return fallback;
  return message;
}

/**
 * Log the raw error under `scope`, then return plain operator copy: out of
 * credit, access refused, not reachable, and so on, or the fallback.
 */
export function operatorError(scope: string, raw: unknown, fallback: string): string {
  logAdminError(scope, raw);
  const { message } = adminErrorParts(raw);
  if (!message || INTERNAL.test(message)) return fallback;
  return operatorMessage(message, fallback);
}

// ---- Operator copy: supplier, vendor, and infra names stay off screen. ----
// No imports in this file so node tests can load it with --experimental-strip-types.

/** Supplier, vendor, and infra names, plus key and scope jargon. */
export const VENDOR_OR_INFRA_PATTERN =
  /sauti\s?kit|resend|supabase|vercel|railway|soniox|gemini|google|openai|anthropic|twilio|africa'?s\s?talking|postgres|postgrest|pgrst|api[\s_.-]?key|service[\s_-]?role|jwt|numbers\.claim|scope_denied|wallet\.read/i;

/** Env-var shaped names such as SAUTIKIT_API_KEY or OPS_EMAIL_FROM. Case-sensitive on purpose. */
export const ENV_NAME_PATTERN = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;

export function hasVendorOrInfraName(text: string): boolean {
  const value = String(text || "");
  return VENDOR_OR_INFRA_PATTERN.test(value) || ENV_NAME_PATTERN.test(value) || INTERNAL.test(value);
}

export type OperatorProblem =
  | "out_of_credit"
  | "access_refused"
  | "too_many_requests"
  | "not_reachable"
  | "not_connected"
  | "unknown";

/** Classify raw upstream or database text into one operator-sized problem. */
export function classifyProblem(raw: string): OperatorProblem {
  const text = String(raw || "");
  if (!text.trim()) return "unknown";
  if (/insufficient|balance|credit|quota|exhaust|billing|payment required|\b402\b|top ?up/i.test(text)) {
    return "out_of_credit";
  }
  if (/scope|denied|forbidden|unauthori[sz]ed|\b401\b|\b403\b|permission|invalid[\s_-]*(api[\s_-]*)?key|not allowed/i.test(text)) {
    return "access_refused";
  }
  if (/\b429\b|rate[\s_-]?limit|too many/i.test(text)) return "too_many_requests";
  if (/timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|unreachable|fetch failed|network|socket hang up|\b50[234]\b/i.test(text)) {
    return "not_reachable";
  }
  if (/not (set|configured)|is missing|missing on|no key|not connected/i.test(text)) return "not_connected";
  return "unknown";
}

const PROBLEM_COPY: Record<Exclude<OperatorProblem, "unknown">, string> = {
  out_of_credit: "Out of credit. Top up the phone line account, then try again.",
  access_refused: "The phone line account refused this. Check its access, then try again.",
  too_many_requests: "Too many requests. Wait a minute, then try again.",
  not_reachable: "Could not reach the service. Try again in a minute.",
  not_connected: "Not connected on this server yet.",
};

/**
 * Plain message for an operator. Known problems get their own line; anything
 * else that names a supplier, env var, or database detail falls back.
 */
export function operatorMessage(raw: unknown, fallback: string): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "").trim();
  const problem = classifyProblem(text);
  if (problem !== "unknown") return PROBLEM_COPY[problem];
  if (!text || text.length > 180 || hasVendorOrInfraName(text)) return fallback;
  return text;
}

const SERVICE_DETAIL: Record<OperatorProblem, string> = {
  out_of_credit: "Out of credit",
  access_refused: "Access refused",
  too_many_requests: "Too many requests",
  not_reachable: "Not reachable",
  not_connected: "Not connected",
  unknown: "Failing",
};

/** Short row detail for the Platform board. Never echoes upstream text. */
export function plainServiceDetail(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "";
  return SERVICE_DETAIL[classifyProblem(text)];
}
