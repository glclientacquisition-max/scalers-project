"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inviteErrorCopy } from "@/lib/invites";
import { lookupInvite } from "@/lib/inviteLookup";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { configuredAppHost } from "@/lib/adminHost";
import { inviteConfirmUrl, originFromHeaders, welcomeHomePath } from "@/lib/authRedirect";
import { acceptByToken, DESK_TENANT_COOKIE, deskTenantCookieOptions } from "@/lib/inviteAccept";

export type InviteActionState = { error?: string; checkEmail?: boolean; existingAccount?: boolean };

async function acceptFor(userId: string, token: string): Promise<InviteActionState> {
  const r = await acceptByToken(token, userId);
  if (!r.ok) return { error: r.error };
  (await cookies()).set(DESK_TENANT_COOKIE, r.tenantId, deskTenantCookieOptions);
  redirect(welcomeHomePath(r.businessName));
}

async function gate(token: string) {
  const invite = await lookupInvite(token);
  if (!invite.found) return { error: "This invite link isn't valid." } as const;
  if (!teamInvitesEnabled(invite.tenantId)) return { error: "Team access isn't switched on for this business yet." } as const;
  if (invite.state !== "pending") return { error: inviteErrorCopy(invite.state === "expired" ? "expired" : "not_pending") } as const;
  return { invite } as const;
}

/** Already signed in with the invited email. */
export async function acceptInviteAction(token: string): Promise<InviteActionState> {
  const g = await gate(token);
  if ("error" in g) return { error: g.error };
  const user = await getAuthUser();
  if (!user) return { error: "Sign in first." };
  if ((user.email || "").toLowerCase() !== g.invite.email.toLowerCase()) {
    return { error: inviteErrorCopy("email_mismatch") };
  }
  return acceptFor(user.id, token);
}

export async function signInAndAcceptAction(
  token: string,
  _prev: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const g = await gate(token);
  if ("error" in g) return { error: g.error };
  const password = String(formData.get("password") || "");
  if (!password) return { error: "Enter your password." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: g.invite.email, password });
  if (error || !data.user) {
    if (/not confirmed/i.test(error?.message || "")) {
      return { error: `Confirm your email first. Open the link we sent to ${g.invite.email}.` };
    }
    return { error: "That password didn't work. Try again, or reset it from the sign-in page." };
  }
  return acceptFor(data.user.id, token);
}

export async function signUpAndAcceptAction(
  token: string,
  _prev: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const g = await gate(token);
  if ("error" in g) return { error: g.error };
  if (g.invite.hasAccount) return { existingAccount: true, error: "You already have a Scalers account. Sign in to accept." };
  const password = String(formData.get("password") || "");
  const name = String(formData.get("full_name") || "").trim().slice(0, 80);
  if (!name) return { error: "Enter your name." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const h = await headers();
  const origin = originFromHeaders((k) => h.get(k), configuredAppHost());
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: g.invite.email,
    password,
    options: {
      // invite=true: the signup trigger does not create a new business for this user.
      data: { invite: "true", full_name: name },
      emailRedirectTo: inviteConfirmUrl(origin, token),
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return { existingAccount: true, error: "You already have a Scalers account. Sign in to accept." };
    }
    return { error: error.message };
  }
  // Supabase returns a user with no identities when the email is already taken.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { existingAccount: true, error: "You already have a Scalers account. Sign in to accept." };
  }
  if (!data.session || !data.user) return { checkEmail: true };
  return acceptFor(data.user.id, token);
}
