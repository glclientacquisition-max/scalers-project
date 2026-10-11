"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  acceptInviteAction,
  signInAndAcceptAction,
  signUpAndAcceptAction,
  type InviteActionState,
} from "./actions";
import { controlClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";


const initial: InviteActionState = {};

function ErrorLine({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="text-meta text-attention">
      {text}
    </p>
  ) : null;
}

function LockedEmail({ email }: { email: string }) {
  return (
    <div>
      <label className="block text-body font-medium text-ink" htmlFor="invite-email">
        Email
      </label>
      <input
        id="invite-email"
        type="email"
        value={email}
        readOnly
        aria-readonly="true"
        autoComplete="username"
        className={`mt-2 ${controlClass} cursor-not-allowed opacity-80`}
      />
      <p className="mt-1 text-meta text-ink-2">This invite is for this email only.</p>
    </div>
  );
}

export function AcceptButton({ token, businessName }: { token: string; businessName: string }) {
  const [state, setState] = useState<InviteActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="primary" size="lg" block
        pending={pending}
        onClick={() => start(async () => setState(await acceptInviteAction(token)))}
      >
        {pending ? "Joining…" : `Join ${businessName}`}
      </Button>
      <ErrorLine text={state.error} />
    </div>
  );
}

export function SignInForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(signInAndAcceptAction.bind(null, token), initial);
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <div>
        <h2 className="text-title text-ink">Sign in to accept</h2>
        <p className="mt-1 text-body text-ink-2">You already have a Scalers account with this email.</p>
      </div>
      <LockedEmail email={email} />
      <div>
        <label className="block text-body font-medium text-ink" htmlFor="invite-password">
          Password
        </label>
        <input
          id="invite-password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className={`mt-2 ${controlClass}`}
        />
      </div>
      <ErrorLine text={state.error} />
      <Button type="submit" variant="primary" size="lg" block pending={pending}>
        {pending ? "Signing in…" : "Sign in and join"}
      </Button>
      <p className="text-meta text-ink-2">
        Forgot your password? Reset it from the{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          sign-in page
        </Link>
        , then open this link again.
      </p>
    </form>
  );
}

export function CreateAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(signUpAndAcceptAction.bind(null, token), initial);
  if (state.existingAccount) return <SignInForm token={token} email={email} />;
  if (state.checkEmail) {
    return (
      <div className="space-y-2" role="status">
        <h2 className="text-title text-ink">Check your email</h2>
        <p className="text-body text-ink-2">
          We sent a confirmation link to {email}. Open it on this device and
          you&apos;ll join straight away. Opened it somewhere else? Come back to this link and sign in.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <div>
        <h2 className="text-title text-ink">Create your account</h2>
      </div>
      <div>
        <label className="block text-body font-medium text-ink" htmlFor="invite-name">
          Your name
        </label>
        <input
          id="invite-name"
          name="full_name"
          required
          autoFocus
          maxLength={80}
          autoComplete="name"
          className={`mt-2 ${controlClass}`}
        />
      </div>
      <LockedEmail email={email} />
      <div>
        <label className="block text-body font-medium text-ink" htmlFor="invite-new-password">
          Password
        </label>
        <input
          id="invite-new-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          aria-describedby="invite-pw-hint"
          className={`mt-2 ${controlClass}`}
        />
        <p id="invite-pw-hint" className="mt-1 text-meta text-ink-2">
          At least 8 characters.
        </p>
      </div>
      <ErrorLine text={state.error} />
      <Button type="submit" variant="primary" size="lg" block pending={pending}>
        {pending ? "Creating account…" : "Create account and join"}
      </Button>
    </form>
  );
}
