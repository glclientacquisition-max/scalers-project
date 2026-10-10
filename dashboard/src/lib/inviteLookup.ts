import { getSupabaseAdmin } from "@/lib/supabase";
import { hashInviteToken, inviteState, type InviteState } from "@/lib/invites";
import { normalizeRole, type Role } from "@/lib/permissions";

export type InviteLookup =
  | { found: false }
  | { found: true; state: InviteState; email: string; role: Role; tenantId: string; businessName: string; expiresAt: string };

/** Service-role lookup by token hash. Never returns the hash or token. */
export async function lookupInvite(token: string): Promise<InviteLookup> {
  if (!token || token.length < 20) return { found: false };
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tenant_invites")
    .select("email, role, status, expires_at, tenant_id")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!data) return { found: false };
  const row = data as { email: string; role: string; status: string; expires_at: string; tenant_id: string };
  const { data: t } = await admin.from("tenants").select("business_name").eq("id", row.tenant_id).maybeSingle();
  return {
    found: true,
    state: inviteState(row),
    email: row.email,
    role: normalizeRole(row.role),
    tenantId: row.tenant_id,
    businessName: String((t as { business_name?: string } | null)?.business_name || "a business"),
    expiresAt: row.expires_at,
  };
}
