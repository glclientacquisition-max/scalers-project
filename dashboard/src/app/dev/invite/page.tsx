import { notFound } from "next/navigation";
import { InviteView } from "@/app/invite/[token]/InviteView";
import type { InvitePageKind } from "@/lib/invitePageState";

export const instant = false;

export default async function DevInvitePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const kind = (sp.kind || "signup") as InvitePageKind;
  return (
    <InviteView
      kind={kind}
      token="dev-token"
      user={kind === "wrong_account" ? { email: "someone@else.com" } : null}
      invite={{ found: true, businessName: "Westlands Phones", email: "wanjiku.mwangi@shop.co.ke", role: "staff", invitedByName: "Alvin", expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString() }}
    />
  );
}
