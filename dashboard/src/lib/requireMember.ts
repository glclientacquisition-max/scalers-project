import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, normalizeRole, type Action, type Role } from "@/lib/permissions";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";

export class AccessDeniedError extends Error {
  constructor(public action: Action) {
    super("You don't have access to do that. Ask the business owner.");
    this.name = "AccessDeniedError";
  }
}

/** Light role lookup for the desk shell (no getCurrentTenant; flag off => owner, no query). */
export async function deskMemberRole(tenantId: string | null | undefined): Promise<Role | null> {
  if (!tenantId) return null;
  if (!teamInvitesEnabled(tenantId)) return "owner";
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tenant_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? normalizeRole(data.role) : null;
}

/** Current member's role in the current workspace. Flag off => "owner" (legacy behaviour). */
export async function currentMemberRole(): Promise<Role | null> {
  const user = await getAuthUser();
  if (!user) return (await isLegacyAuthenticated()) ? "owner" : null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  if (!teamInvitesEnabled(tenant.id)) return "owner";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tenant_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  return data ? normalizeRole(data.role) : null;
}

/**
 * Server-side authorization for every desk server action.
 * Unauthenticated callers fall through to the action's own "Sign in" handling;
 * an authenticated member without the permission gets AccessDeniedError.
 */
export async function requireMember(action: Action): Promise<Role | null> {
  const role = await currentMemberRole();
  if (role === null) return null;
  if (!can(role, action)) throw new AccessDeniedError(action);
  return role;
}

/** Page-level check: null role (signed out / no workspace) passes so the page's own handling runs. */
export async function memberCan(action: Action): Promise<boolean> {
  const role = await currentMemberRole();
  return role === null || can(role, action);
}
