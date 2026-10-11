/** Pure state machine for /invite/[token]. Tested in tests/invitePageState.test.ts. */
import type { InviteState } from "./invites";

export type InvitePageKind =
  | "invalid"
  | "expired"
  | "revoked"
  | "accepted"
  | "accepted_self"
  | "wrong_account"
  | "accept"
  | "signin"
  | "signup";

export function invitePageKind(input: {
  found: boolean;
  enabled: boolean;
  state?: InviteState;
  inviteEmail?: string;
  hasAccount?: boolean;
  signedInEmail?: string | null;
  isMember?: boolean;
}): InvitePageKind {
  if (!input.found || !input.enabled) return "invalid";
  const same =
    !!input.signedInEmail && String(input.signedInEmail).toLowerCase() === String(input.inviteEmail || "").toLowerCase();
  if (input.state === "accepted") return same && input.isMember ? "accepted_self" : "accepted";
  if (input.state === "expired") return "expired";
  if (input.state === "revoked") return "revoked";
  if (input.signedInEmail) return same ? "accept" : "wrong_account";
  return input.hasAccount ? "signin" : "signup";
}

export function expiryLabel(expiresAt: string, now = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!(ms > 0)) return "This invite has expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `Expires in ${days} days`;
  if (days === 1) return "Expires tomorrow";
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}
