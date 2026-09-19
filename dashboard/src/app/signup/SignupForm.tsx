"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type SignupState } from "./actions";
import { btnPrimary, deskFieldClass, pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: SignupState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initial);

  if (state.checkEmail) {
    return (
      <div className="mt-10 rounded-panel border border-line bg-surface p-6">
        <p className="font-medium text-ink">Check your email</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Confirm the link, then sign in.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-accent-deep hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-8 space-y-4 rounded-panel border border-line bg-surface p-6"
    >
      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="business_name">
          Business name
        </label>
        <input
          id="business_name"
          name="business_name"
          required
          autoFocus
          className={`mt-2 ${deskFieldClass}`}
          placeholder="Jirani Home Services"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={`mt-2 ${deskFieldClass}`}
          placeholder="you@business.co.ke"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={`mt-2 ${deskFieldClass}`}
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="notification_phone">
          Notification phone
        </label>
        <input
          id="notification_phone"
          name="notification_phone"
          type="tel"
          required
          className={`mt-2 ${deskFieldClass}`}
          placeholder="+2547…"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${btnPrimary} w-full gap-2`}>
        {pending ? (
          <>
            <span aria-hidden="true" className={pendingSpinnerClass} />
            Creating workspace
          </>
        ) : (
          "Create workspace"
        )}
      </button>
    </form>
  );
}
