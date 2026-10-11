import { getSupabaseAdmin } from "@/lib/supabase";
import { hashInviteToken, inviteState, type InviteState } from "@/lib/invites";
import { normalizeRole, type Role } from "@/lib/permissions";

export type InviteLookup =
  | { found: false }
  | {
      found: true;
      state: InviteState;
      email: string;
      role: Role;
      tenantId: string;
      businessName: string;
      expiresAt: string;
      invitedByName: string | null;
      hasAccount: boolean;
    };

function displayName(meta: Record<string, unknown> | undefined, email: string | undefined): string | null {
  const n = String(meta?.full_name || meta?.name || "").trim();
  return n || (email ? email : null);
}

/** Service-role lookup by token hash. Never returns the hash or token. */
export async function lookupInvite(token: string): Promise<InviteLookup> {
  if (!token || token.length < 20) return { found: false };
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tenant_invites")
    .select("email, role, status, expires_at, tenant_id, invited_by")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!data) return { found: false };
  const row = data as { email: string; role: string; status: string; expires_at: string; tenant_id: string; invited_by: string | null };
  const [tenant, inviter, account] = await Promise.all([
    admin.from("tenants").select("business_name").eq("id", row.tenant_id).maybeSingle(),
    row.invited_by ? admin.auth.admin.getUserById(row.invited_by).catch(() => null) : Promise.resolve(null),
    admin.rpc("invite_email_has_account", { p_email: row.email }).then(
      (r) => r,
      () => ({ data: false })
    ),
  ]);
  const u = inviter && "data" in inviter ? inviter.data?.user : null;
  return {
    found: true,
    state: inviteState(row),
    email: row.email,
    role: normalizeRole(row.role),
    tenantId: row.tenant_id,
    businessName: String((tenant.data as { business_name?: string } | null)?.business_name || "a business"),
    expiresAt: row.expires_at,
    invitedByName: u ? displayName(u.user_metadata, u.email) : null,
    hasAccount: Boolean((account as { data?: unknown }).data),
  };
}
