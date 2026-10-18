/**
 * Short call link from staff SMS: app.scalers.co.ke/c/<code> (#777).
 * calls.short_code: 6-8 chars, no 0/O/1/I/L (supabase/migrations/20261018230000_call_short_code.sql).
 * Pure, no server imports. The page is src/app/c/[code]/page.tsx.
 */

export const SHORT_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,8}$/;

/** Upper-cased code when it can be one, else null. */
export function normalizeShortCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  return SHORT_CODE_RE.test(s) ? s : null;
}

export function shortLinkPath(code: string): string {
  return `/c/${code}`;
}

/** Sign-in page that comes back to the link. */
export function shortLinkLoginHref(code: string): string {
  return `/login?next=${encodeURIComponent(shortLinkPath(code))}`;
}

/** next after sign-in: only a short call link path; anything else is ignored. */
export function loginNextPath(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = /^\/c\/([^/?#]+)$/.exec(s);
  const code = m ? normalizeShortCode(m[1]) : null;
  return code ? shortLinkPath(code) : null;
}

export type ShortLinkCall = { id: string; tenant_id: string } | null;

export type ShortLinkDecision =
  | { kind: "login"; href: string }
  | { kind: "not_found" }
  | { kind: "open"; callId: string; tenantId: string; href: string; switchTenant: boolean };

/**
 * Signed out: sign in, then back here. Unknown code and a call in a business
 * the person is not a member of get the same not-found (no hint either way).
 */
export function decideShortCallLink({
  code,
  signedIn,
  call,
  memberTenantIds,
  currentTenantId,
}: {
  code: string | null;
  signedIn: boolean;
  call: ShortLinkCall;
  memberTenantIds: readonly string[];
  currentTenantId?: string | null;
}): ShortLinkDecision {
  if (!code) return { kind: "not_found" };
  if (!signedIn) return { kind: "login", href: shortLinkLoginHref(code) };
  if (!call?.id || !call.tenant_id || !memberTenantIds.includes(call.tenant_id)) return { kind: "not_found" };
  return {
    kind: "open",
    callId: call.id,
    tenantId: call.tenant_id,
    href: `/calls/${encodeURIComponent(call.id)}`,
    switchTenant: Boolean(currentTenantId) && currentTenantId !== call.tenant_id,
  };
}
