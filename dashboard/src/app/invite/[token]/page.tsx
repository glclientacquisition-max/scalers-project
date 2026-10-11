import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary, metaLabelClass } from "@/components/ui/deskChrome";
import { getAuthUser } from "@/lib/auth";
import { lookupInvite } from "@/lib/inviteLookup";
import { expiryLabel, invitePageKind } from "@/lib/invitePageState";
import { ROLE_BLURBS, ROLE_LABELS } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { AcceptButton, CreateAccountForm, SignInForm } from "./InviteForms";

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

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <section className="glass-chrome mt-8 rounded-panel border border-line p-6" aria-live="polite">
      <h1 className="font-display text-xl tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

const signInLink = (
  <Link href="/login" className={`${btnPrimary} inline-flex`}>
    Go to sign in
  </Link>
);

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

  if (kind === "invalid" || !invite.found) {
    return (
      <Shell>
        <Notice title="This invite link isn't valid" body="Check you opened the full link from the email, or ask for a new invite." />
      </Shell>
    );
  }
  if (kind === "expired") {
    return (
      <Shell>
        <Notice title="This invite has expired" body={`Ask the person who invited you to ${invite.businessName} to send a new one.`} />
      </Shell>
    );
  }
  if (kind === "revoked") {
    return (
      <Shell>
        <Notice title="This invite was cancelled" body={`It no longer gives access to ${invite.businessName}. Ask for a new one if you still need access.`} />
      </Shell>
    );
  }
  if (kind === "accepted_self") {
    return (
      <Shell>
        <Notice
          title={`You're already in ${invite.businessName}`}
          body="This invite has been accepted."
          action={<Link href="/home" className={`${btnPrimary} inline-flex`}>Open the dashboard</Link>}
        />
      </Shell>
    );
  }
  if (kind === "accepted") {
    return (
      <Shell>
        <Notice title="This invite has already been used" body={`If it was you, sign in with ${invite.email}.`} action={user ? undefined : signInLink} />
      </Shell>
    );
  }

  const role = ROLE_LABELS[invite.role];
  return (
    <Shell>
      <section className="glass-chrome mt-8 rounded-panel border border-line p-6">
        <p className={metaLabelClass}>Team invite</p>
        <h1 className="mt-1 font-display text-2xl tracking-tight text-ink">Join {invite.businessName}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {invite.invitedByName ? (
            <>
              <strong className="font-medium text-ink">{invite.invitedByName}</strong> invited you to the team on Scalers.
            </>
          ) : (
            "You've been invited to the team on Scalers."
          )}
        </p>
        <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
          <div>
            <dt className={metaLabelClass}>Your role</dt>
            <dd className="mt-1 text-ink">
              <span className="font-medium">{role}</span>
              <span className="text-ink-soft"> · {ROLE_BLURBS[invite.role]}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <dt className={metaLabelClass}>Invite for</dt>
              <dd className="mt-1 break-all text-ink">{invite.email}</dd>
            </div>
            <dd className="shrink-0 text-xs text-ink-soft">{expiryLabel(invite.expiresAt)}</dd>
          </div>
        </dl>

        {confirmed === "1" && !user ? (
          <p className="mt-5 rounded-md border border-line bg-accent/10 px-3 py-2 text-sm text-ink" role="status">
            Email confirmed. Sign in to finish joining.
          </p>
        ) : null}

        <div className="mt-6 border-t border-line pt-5">
          {kind === "accept" ? (
            <AcceptButton token={token} businessName={invite.businessName} />
          ) : kind === "wrong_account" ? (
            <div className="space-y-3 text-sm text-ink-soft">
              <p>
                You&apos;re signed in as <strong className="text-ink">{user?.email}</strong>, but this invite is for{" "}
                <strong className="text-ink">{invite.email}</strong>.
              </p>
              <form action="/api/logout" method="post">
                <input type="hidden" name="next" value={`/invite/${encodeURIComponent(token)}`} />
                <button type="submit" className={`${btnPrimary} w-full`}>
                  Sign out and continue
                </button>
              </form>
            </div>
          ) : kind === "signin" ? (
            <SignInForm token={token} email={invite.email} />
          ) : (
            <CreateAccountForm token={token} email={invite.email} />
          )}
        </div>
      </section>
      <p className="mt-4 text-center text-xs text-ink-soft">Not expecting this? You can ignore it. Nothing happens until you accept.</p>
    </Shell>
  );
}
