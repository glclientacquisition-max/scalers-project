"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type SignupState } from "./actions";

const initial: SignupState = {};

const fieldClass =
  "mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initial);

  if (state.checkEmail) {
    return (
      <div className="mt-10 rounded-panel border border-line bg-surface p-6">
        <p className="font-medium text-ink">Check your email</p>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          We sent a confirmation link. After you confirm, sign in.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block text-sm font-medium text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-8 rounded-panel border border-line bg-surface p-6 shadow-lift space-y-4"
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
          className={fieldClass}
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
          className={fieldClass}
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
          className={fieldClass}
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
          className={fieldClass}
          placeholder="+2547…"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-[#0096FF] px-4 py-3 text-white font-medium transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 disabled:opacity-60"
      >
        {pending ? "Creating workspace…" : "Create Scalers workspace"}
      </button>
    </form>
  );
}
