"use client";

import { useActionState, useState, useTransition } from "react";
import {
  acceptInviteAction,
  signInAndAcceptAction,
  signUpAndAcceptAction,
  type InviteActionState,
} from "./actions";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";

const initial: InviteActionState = {};

export function AcceptButton({ token }: { token: string }) {
  const [state, setState] = useState<InviteActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="mt-6">
      <button type="button" className={btnPrimary} disabled={pending} onClick={() => start(async () => setState(await acceptInviteAction(token)))}>
        {pending ? "Joining…" : "Join"}
      </button>
      {state.error ? <p role="alert" className="mt-3 text-sm text-warn">{state.error}</p> : null}
    </div>
  );
}

export function SignInOrUp({ token, email }: { token: string; email: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [inState, inAction, inPending] = useActionState(signInAndAcceptAction.bind(null, token), initial);
  const [upState, upAction, upPending] = useActionState(signUpAndAcceptAction.bind(null, token), initial);
  if (upState.checkEmail) {
    return (
      <p className="mt-6 text-sm text-ink-soft">
        Check {email} for a confirmation link. It brings you back here to finish joining.
      </p>
    );
  }
  const state = mode === "signin" ? inState : upState;
  return (
    <div className="mt-6 space-y-4">
      <div className="flex gap-4 text-sm">
        <button type="button" onClick={() => setMode("signup")} className={mode === "signup" ? "font-medium text-ink" : "text-ink-soft"}>
          New to Scalers
        </button>
        <button type="button" onClick={() => setMode("signin")} className={mode === "signin" ? "font-medium text-ink" : "text-ink-soft"}>
          I have an account
        </button>
      </div>
      <form action={mode === "signin" ? inAction : upAction} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-ink" htmlFor="invite-email-locked">Email</label>
          <input id="invite-email-locked" value={email} readOnly className={`mt-2 ${deskFieldClass} opacity-80`} />
        </div>
        {mode === "signup" ? (
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="full_name">Your name</label>
            <input id="full_name" name="full_name" required maxLength={80} className={`mt-2 ${deskFieldClass}`} />
          </div>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-ink" htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={`mt-2 ${deskFieldClass}`}
          />
        </div>
        <button type="submit" className={btnPrimary} disabled={inPending || upPending}>
          {mode === "signup" ? "Create account and join" : "Sign in and join"}
        </button>
        {state.error ? <p role="alert" className="text-sm text-warn">{state.error}</p> : null}
      </form>
    </div>
  );
}
