import { H } from "./state.mjs";

/** Signed-in operator (H.operator); null = signed out. */
export async function requireAdminOperatorWrite() {
  return H.operator ? { ok: true, operator: H.operator } : { ok: false, status: 401, error: "Sign in again." };
}
