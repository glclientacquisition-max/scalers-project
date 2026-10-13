/**
 * Feature flag for team member logins, roles and invites. Default OFF.
 * TEAM_INVITES_ENABLED=true enables roles + invites for every workspace, or
 * TEAM_INVITES_TENANTS=<uuid,uuid> enables it for listed workspaces only.
 * While off, every signed-in member is treated as owner (pre-feature behaviour).
 */
export function teamInvitesEnabled(tenantId?: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.TEAM_INVITES_ENABLED || "").trim().toLowerCase() === "true") return true;
  const list = String(env.TEAM_INVITES_TENANTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Boolean(tenantId && list.includes(tenantId));
}
