import { getAuthUser } from "@/lib/auth";
import { lookupInvite } from "@/lib/inviteLookup";
import { invitePageKind } from "@/lib/invitePageState";
import { getSupabaseAdmin } from "@/lib/supabase";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { InviteView, type InviteViewInvite } from "./InviteView";

export const instant = false;

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const { token } = await params;
  const { confirmed } = await searchParams;
  const invite = await lookupInvite(token);
  const user = await getAuthUser();
  const enabled = invite.found && teamInvitesEnabled(invite.tenantId);

  let isMember = false;
  if (invite.found && user && invite.state === "accepted") {
    const { data } = await getSupabaseAdmin()
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", invite.tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    isMember = Boolean(data);
  }

  const kind = invitePageKind({
    found: invite.found,
    enabled,
    state: invite.found ? invite.state : undefined,
    inviteEmail: invite.found ? invite.email : undefined,
    hasAccount: invite.found ? invite.hasAccount || confirmed === "1" : false,
    signedInEmail: user?.email ?? null,
    isMember,
  });

  return <InviteView kind={kind} invite={invite as unknown as InviteViewInvite} token={token} user={user} confirmed={confirmed} />;
}
