import { findAdminOperator, normalizeAdminUsername } from "@/lib/adminOperators";
import { getAdminSession, isAdminAuthenticated } from "@/lib/auth";

/**
 * Operator-only gate for Admin writes that must not accept the legacy
 * shared-password cookie. Requires a Better Auth Super Admin session whose
 * username is still on ADMIN_OPERATORS (when that list is set).
 */
export type AdminOperatorOk = { ok: true; operator: string };
export type AdminOperatorReject = { ok: false; status: 401 | 403; error: string };
export type AdminOperatorResult = AdminOperatorOk | AdminOperatorReject;

export async function requireAdminOperatorWrite(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminOperatorResult> {
  const session = await getAdminSession();
  const username = normalizeAdminUsername(String(session?.user?.name || ""));
  if (!username) {
    return {
      ok: false,
      status: 401,
      error: "Sign in as an operator to continue.",
    };
  }
  // When ADMIN_OPERATORS (or the shared-code fallback) is configured, the
  // session name must still match a listed operator. Empty list = misconfigured
  // Preview; reject so a leftover cookie cannot write.
  const listed = findAdminOperator(username, env);
  if (!listed) {
    return {
      ok: false,
      status: 403,
      error: "Operator access required.",
    };
  }
  return { ok: true, operator: listed.username };
}

/** JSON API read gate: signed-in Super Admin (same session rules as pages). */
export async function requireAdminApiRead(): Promise<{ ok: true } | AdminOperatorReject> {
  if (!(await isAdminAuthenticated())) {
    return { ok: false, status: 403, error: "Sign in to continue." };
  }
  return { ok: true };
}
