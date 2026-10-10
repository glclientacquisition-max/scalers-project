"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { hashInviteToken, inviteErrorCopy } from "@/lib/invites";
import { lookupInvite } from "@/lib/inviteLookup";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { configuredAppHost } from "@/lib/adminHost";

export type InviteActionState = { error?: string; checkEmail?: boolean };

async function acceptFor(userId: string, token: string): Promise<InviteActionState> {
  const { data, error } = await getSupabaseAdmin().rpc("accept_tenant_invite", {
    p_token_hash: hashInviteToken(token),
    p_user: userId,
  });
  if (error) return { error: inviteErrorCopy(error.message) };
  const jar = await cookies();
  jar.set(DESK_TENANT_COOKIE, String(data), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/home");
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
  if (error || !data.user) return { error: "That password didn't work. Try again or reset it on the sign-in page." };
  return acceptFor(data.user.id, token);
}

export async function signUpAndAcceptAction(
  token: string,
  _prev: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const g = await gate(token);
  if ("error" in g) return { error: g.error };
  const password = String(formData.get("password") || "");
  const name = String(formData.get("full_name") || "").trim().slice(0, 80);
  if (!name) return { error: "Enter your name." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: g.invite.email,
    password,
    options: {
      // invite=true: the signup trigger does not create a new business for this user.
      data: { invite: "true", full_name: name },
      emailRedirectTo: `https://${configuredAppHost()}/invite/${encodeURIComponent(token)}`,
    },
  });
  if (error) return { error: error.message };
  if (!data.session || !data.user) return { checkEmail: true };
  return acceptFor(data.user.id, token);
}
