"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type SignupState } from "./actions";

const initial: SignupState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initial);

  if (state.checkEmail) {
    return (
      <div className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <p className="font-medium text-[var(--ink)]">Check your email</p>
        <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
          We sent a confirmation link. After you confirm, sign in to open your Sauti Desk
          workspace.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-deep)]"
        >
          Go to sign in →
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-[0_20px_50px_-35px_rgba(28,36,33,0.45)] space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="business_name">
          Business name
        </label>
        <input
          id="business_name"
          name="business_name"
          required
          autoFocus
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          placeholder="Jirani Home Services"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          placeholder="you@business.co.ke"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-[var(--ink)]"
          htmlFor="notification_phone"
        >
          Notification phone
        </label>
        <input
          id="notification_phone"
          name="notification_phone"
          type="tel"
          required
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          placeholder="+2547…"
        />
        <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
          Where we send missed-call lead alerts (WhatsApp / Telegram later). The receptionist
          automatically speaks English, Kiswahili, and Sheng.
        </p>
      </div>

      {state.error ? <p className="text-sm text-[var(--warn)]">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-white font-medium hover:bg-[var(--accent-deep)] transition disabled:opacity-60"
      >
        {pending ? "Creating workspace…" : "Create Sauti Desk"}
      </button>
    </form>
  );
}
