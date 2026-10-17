/**
 * Who did it. Admin writes take the actor from the signed-in Super Admin
 * session, never from a typed name or a request body.
 * Pure module so node tests can load it.
 */

/** Actor when the request came through the old shared-password cookie (no named operator). */
export const SHARED_LOGIN_ACTOR = "shared-login";

export function actorFromSession(
  session: { user?: { name?: string | null } | null } | null | undefined,
): string {
  const name = String(session?.user?.name || "").trim();
  return name || SHARED_LOGIN_ACTOR;
}
