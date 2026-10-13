import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { cache } from "react";
import { getCurrentTenant, memberRowsForUser } from "@/lib/tenant";
import { can, deniedMessage, normalizeRole, type Action, type Role } from "@/lib/permissions";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";

export class AccessDeniedError extends Error {
  constructor(public action: Action, role?: Role | null) {
    super(deniedMessage(role, action));
    this.name = "AccessDeniedError";
  }
}

export type DeniedResult = { ok: false; error: string; denied: true };

/** Light role lookup for the desk shell (no getCurrentTenant; flag off => owner, no query). */
export const deskMemberRole = cache(async (tenantId: string | null | undefined): Promise<Role | null> => {
  if (!tenantId) return null;
  if (!teamInvitesEnabled(tenantId)) return "owner";
  const user = await getAuthUser();
  if (!user) return null;
  const row = (await memberRowsForUser(user.id)).find((r) => r.tenant_id === tenantId);
  return row ? normalizeRole(row.role) : null;
});

/** Current member's role in the current workspace. Flag off => "owner" (legacy behaviour). */
export const currentMemberRole = cache(async (): Promise<Role | null> => {
  const user = await getAuthUser();
  if (!user) return (await isLegacyAuthenticated()) ? "owner" : null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  if (!teamInvitesEnabled(tenant.id)) return "owner";
  const row = (await memberRowsForUser(user.id)).find((r) => r.tenant_id === tenant.id);
  return row ? normalizeRole(row.role) : null;
});

/**
 * Server-side authorization for every desk server action.
 * Unauthenticated callers fall through to the action's own "Sign in" handling;
 * an authenticated member without the permission gets AccessDeniedError.
 */
export async function requireMember(action: Action): Promise<Role | null> {
  const role = await currentMemberRole();
  if (role === null) return null;
  if (!can(role, action)) throw new AccessDeniedError(action, role);
  return role;
}

/**
 * Preferred guard for server actions: returns a result the UI can show instead of throwing
 * (a thrown error is redacted by Next and lands on the crash screen).
 * Usage: `const denied = await memberDenied("settings.edit"); if (denied) return denied;`
 * Signed-out / no-workspace callers return null so the action's own handling runs.
 */
export async function memberDenied(action: Action): Promise<DeniedResult | null> {
  const role = await currentMemberRole();
  if (role === null || can(role, action)) return null;
  return { ok: false, error: deniedMessage(role, action), denied: true };
}

/** Page-level check: null role (signed out / no workspace) passes so the page's own handling runs. */
export async function memberCan(action: Action): Promise<boolean> {
  const role = await currentMemberRole();
  return role === null || can(role, action);
}
