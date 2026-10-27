"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestAccessAction, type SignupState } from "./actions";
import { btnPrimary, deskFieldClass, pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: SignupState = {};

export function RequestAccessForm() {
  const [state, formAction, pending] = useActionState(requestAccessAction, initial);

  if (state.submitted) {
    return (
      <div className="mt-8 rounded-panel border border-line bg-surface p-6">
        <p className="font-medium text-ink">Thanks, we&apos;ll be in touch.</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          We review new businesses by hand. If it&apos;s a fit, you&apos;ll get an email to set your password.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-accent-deep hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-8 space-y-4 rounded-panel border border-line bg-surface p-5 sm:p-6"
    >
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
        <label htmlFor="company_website">Company website</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          autoFocus
          autoComplete="name"
          className={`mt-2 ${deskFieldClass}`}
          placeholder="Jane Wanjiru"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="business_name">
          Business name
        </label>
        <input
          id="business_name"
          name="business_name"
          required
          autoComplete="organization"
          className={`mt-2 ${deskFieldClass}`}
          placeholder="Jirani Home Services"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="phone">
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          className={`mt-2 ${deskFieldClass}`}
          placeholder="+2547…"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="email">
          Email
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
        <label className="block text-sm font-medium text-ink" htmlFor="about">
          What does the business do?
        </label>
        <textarea
          id="about"
          name="about"
          required
          rows={3}
          maxLength={500}
          className={`mt-2 ${deskFieldClass} min-h-[5.5rem] resize-y`}
          placeholder="Short summary for our team"
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
            Sending
          </>
        ) : (
          "Request access"
        )}
      </button>
    </form>
  );
}
