import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { hashInviteToken, inviteErrorCopy } from "@/lib/invites";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";

export type AcceptResult = { ok: true; tenantId: string; businessName: string } | { ok: false; error: string };

export const deskTenantCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

async function businessName(tenantId: string): Promise<string> {
  const { data } = await getSupabaseAdmin().from("tenants").select("business_name").eq("id", tenantId).maybeSingle();
  return String((data as { business_name?: string } | null)?.business_name || "your team");
}

/** Atomic accept via the service-role RPC (checks status, expiry, email match, seats). */
export async function acceptByTokenHash(tokenHash: string, userId: string): Promise<AcceptResult> {
  const { data, error } = await getSupabaseAdmin().rpc("accept_tenant_invite", { p_token_hash: tokenHash, p_user: userId });
  if (error || !data) return { ok: false, error: inviteErrorCopy(error?.message) };
  const tenantId = String(data);
  return { ok: true, tenantId, businessName: await businessName(tenantId) };
}

export function acceptByToken(token: string, userId: string): Promise<AcceptResult> {
  return acceptByTokenHash(hashInviteToken(token), userId);
}

/**
 * Safety net for when the confirmation link opened on another device or Supabase
 * dropped the redirect: a confirmed user who signs in joins every pending, unexpired
 * invite sent to their email (flag permitting). Returns the newest joined workspace.
 */
export async function acceptPendingInvitesForUser(user: { id: string; email?: string | null }): Promise<AcceptResult | null> {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return null;
  const { data } = await getSupabaseAdmin()
    .from("tenant_invites")
    .select("token_hash, tenant_id, created_at")
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  let joined: AcceptResult | null = null;
  for (const row of (data || []) as Array<{ token_hash: string; tenant_id: string }>) {
    if (!teamInvitesEnabled(row.tenant_id)) continue;
    const r = await acceptByTokenHash(row.token_hash, user.id);
    if (r.ok && !joined) joined = r;
  }
  return joined;
}

export { DESK_TENANT_COOKIE };
