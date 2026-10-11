import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { buttonClass } from "@/components/ui/Button";
import { expiryLabel, type InvitePageKind } from "@/lib/invitePageState";
import { ROLE_BLURBS, ROLE_LABELS } from "@/lib/permissions";
import { AcceptButton, CreateAccountForm, SignInForm } from "./InviteForms";


const primary = buttonClass({ variant: "primary", size: "lg", block: true });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh justify-center bg-surface-canvas px-4 pb-16 pt-10 sm:items-center sm:px-6 sm:pt-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/login" context="Invite" variant="lockup" priority />
        {children}
      </div>
    </main>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <section className="mt-8 space-y-5" aria-live="polite">
      <div className="space-y-2 px-1">
        <h1 className="text-page text-ink">{title}</h1>
        <p className="text-body text-ink-2">{body}</p>
      </div>
      {action}
    </section>
  );
}

/** Grouped inset row: label left, value right (iOS settings style). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-body text-ink">{label}</dt>
      <dd className="min-w-0 break-all text-end text-body text-ink-2">{children}</dd>
    </div>
  );
}

const signInLink = (
  <Link href="/login" className={primary}>
    Go to sign in
  </Link>
);

export type InviteViewInvite = {
  found: boolean;
  businessName: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  invitedByName?: string | null;
  expiresAt: string;
};

/** Every invite screen, from data only (the route loads; /dev/invite renders fixtures). */
export function InviteView({
  kind,
  invite,
  token,
  user,
  confirmed,
}: {
  confirmed?: string;
  kind: InvitePageKind;
  invite: InviteViewInvite;
  token: string;
  user: { email?: string | null } | null;
}) {
  if (kind === "invalid" || !invite.found) {
    return (
      <Shell>
        <Notice title="This link isn't valid" body="Open the full link from the email, or ask for a new invite." />
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
          action={<Link href="/home" className={primary}>Open the dashboard</Link>}
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
      <section className="mt-8 space-y-6">
        <div className="space-y-2 px-1">
          <h1 className="text-page text-ink">Join {invite.businessName}</h1>
          <p className="text-body text-ink-2">
            {invite.invitedByName ? `${invite.invitedByName} invited you to the team.` : "You've been invited to the team."}
          </p>
        </div>

        <div className="space-y-1.5">
          <dl className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            <Row label="Role">{role}</Row>
            <Row label="Email">{invite.email}</Row>
            <Row label="Expires">{expiryLabel(invite.expiresAt)}</Row>
          </dl>
          <p className="px-4 text-meta text-ink-2">{ROLE_BLURBS[invite.role]}</p>
        </div>

        {confirmed === "1" && !user ? (
          <p className="rounded-2xl bg-accent-tonal px-4 py-3 text-body text-ink" role="status">
            Email confirmed. Sign in to finish joining.
          </p>
        ) : null}

        {kind === "accept" ? (
          <AcceptButton token={token} businessName={invite.businessName} />
        ) : kind === "wrong_account" ? (
          <div className="space-y-4">
            <p className="px-1 text-body text-ink-2">
              You&apos;re signed in as {user?.email}. This invite is for {invite.email}.
            </p>
            <form action="/api/logout" method="post">
              <input type="hidden" name="next" value={`/invite/${encodeURIComponent(token)}`} />
              <button type="submit" className={primary}>
                Sign out and continue
              </button>
            </form>
          </div>
        ) : kind === "signin" ? (
          <SignInForm token={token} email={invite.email} />
        ) : (
          <CreateAccountForm token={token} email={invite.email} />
        )}
      </section>
      <p className="mt-6 px-1 text-center text-meta text-ink-2">Not expecting this? Ignore it. Nothing happens until you accept.</p>
    </Shell>
  );
}
