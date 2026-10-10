import { BrandWordmark } from "@/components/brand/BrandMark";
import { getAuthUser } from "@/lib/auth";
import { lookupInvite } from "@/lib/inviteLookup";
import { inviteErrorCopy } from "@/lib/invites";
import { ROLE_BLURBS, ROLE_LABELS } from "@/lib/permissions";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { AcceptButton, SignInOrUp } from "./InviteForms";

export const instant = false;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/login" context="Invite" variant="lockup" priority />
        {children}
      </div>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupInvite(token);
  if (!invite.found || !teamInvitesEnabled(invite.tenantId)) {
    return <Shell><p className="mt-8 text-ink-soft">This invite link isn&apos;t valid.</p></Shell>;
  }
  if (invite.state !== "pending") {
    return (
      <Shell>
        <p className="mt-8 text-ink-soft">{inviteErrorCopy(invite.state === "expired" ? "expired" : "not_pending")}</p>
      </Shell>
    );
  }
  const user = await getAuthUser();
  const match = user && (user.email || "").toLowerCase() === invite.email.toLowerCase();
  return (
    <Shell>
      <h1 className="mt-8 font-display text-2xl tracking-tight text-ink">Join {invite.businessName}</h1>
      <p className="mt-2 text-ink-soft">
        You&apos;re invited as <strong className="text-ink">{ROLE_LABELS[invite.role]}</strong>. {ROLE_BLURBS[invite.role]}
      </p>
      {match ? (
        <AcceptButton token={token} />
      ) : user ? (
        <div className="mt-6 space-y-3 text-sm text-ink-soft">
          <p>
            You&apos;re signed in as {user.email}, but this invite is for {invite.email}.
          </p>
          <form action="/api/logout" method="post">
            <button type="submit" className="font-medium text-accent-deep hover:underline">Sign out and continue</button>
          </form>
        </div>
      ) : (
        <SignInOrUp token={token} email={invite.email} />
      )}
    </Shell>
  );
}
