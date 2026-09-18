/**
 * Keep in lockstep with src/conversation/callerNameQuality.js
 * Names that must never be stored as the caller or shown on SMS.
 */

export const JUNK_CALLER_NAMES = new Set([
  "calling",
  "callings",
  "haijawekwa",
  "caller",
  "customer",
  "client",
  "guest",
  "unknown",
  "test",
  "testing",
  "user",
  "theexact",
  "the exact",
  "or the",
  "n/a",
  "na",
  "none",
  "receptionist",
  "agent",
  "assistant",
  "ai",
  "bot",
]);

export function cleanCallerName(raw: unknown): string {
  return String(raw || "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isJunkCallerName(raw: unknown): boolean {
  const name = cleanCallerName(raw);
  if (!name) return true;
  const lower = name.toLowerCase();
  const compact = lower.replace(/[\s'-]+/g, "");
  if (JUNK_CALLER_NAMES.has(lower) || JUNK_CALLER_NAMES.has(compact)) return true;
  if (/^(where|what|when|who|how|why)(\s+are you)?$/i.test(lower)) return true;
  return false;
}

export function sanitizeStoredCallerName(raw: unknown): string | null {
  const name = cleanCallerName(raw);
  if (!name || isJunkCallerName(name)) return null;
  return name;
}
