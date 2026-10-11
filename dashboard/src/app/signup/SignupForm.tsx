"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signupAction, type SignupState } from "./actions";
import { ResendLink } from "./ResendLink";
import { Field, Input } from "@/components/ui/Field";
import { btnPrimary, pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: SignupState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initial);
  const [restart, setRestart] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.field) return;
    const el = formRef.current?.querySelector<HTMLInputElement>(`[name="${state.field}"]`);
    el?.focus();
  }, [state]);

  if (state.checkEmail && restart === 0) {
    return (
      <section aria-labelledby="check-email" className="mt-8">
        <h1 id="check-email" className="text-display text-ink">
          Check your email
        </h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">
          We sent a link to <span className="font-medium text-ink">{state.email}</span>. Open it to
          confirm your email and start setting up.
        </p>
        <div className="mt-6 rounded-2xl bg-surface p-4">
          <ResendLink email={state.email || ""} />
        </div>
        <p className="mt-6 text-meta text-ink-2">
          Wrong email?{" "}
          <button
            type="button"
            onClick={() => setRestart(1)}
            className="min-h-11 font-medium text-accent-deep underline-offset-2 hover:underline"
          >
            Start again
          </button>
        </p>
      </section>
    );
  }

  const v = state.values;
  const err = (field: SignupState["field"]) => (state.field === field ? state.error : undefined);
  const generalError = state.error && !state.field ? state.error : null;

  return (
    <>
      <h1 className="mt-8 text-display text-ink">Create your account</h1>
      <p className="mt-2 text-body text-ink-2">Set up your receptionist in about five minutes.</p>
      <form
        ref={formRef}
        key={restart}
        action={formAction}
        noValidate
        className="mt-6 space-y-4"
        aria-describedby={generalError ? "signup-error" : undefined}
      >
        <Field id="business_name" label="Business name" error={err("business_name")}>
          {(p) => (
            <Input {...p} name="business_name" defaultValue={v?.business_name} autoComplete="organization" maxLength={120} autoFocus />
          )}
        </Field>
        <Field id="email" label="Email" error={err("email")}>
          {(p) => (
            <Input {...p} name="email" type="email" defaultValue={v?.email} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} />
          )}
        </Field>
        {state.signIn ? (
          <p className="-mt-2 text-meta">
            <Link href="/login" className="font-medium text-accent-deep underline-offset-2 hover:underline">
              Sign in instead
            </Link>
          </p>
        ) : null}
        <Field id="password" label="Password" hint="At least 8 characters." error={err("password")}>
          {(p) => (
            <div className="relative">
              <Input {...p} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} className="pr-20" />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                aria-controls="password"
                className="absolute inset-y-0 right-1 my-auto h-11 rounded-lg px-3 text-meta font-medium text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          )}
        </Field>
        <Field
          id="notification_phone"
          label="Mobile number"
          hint="We'll WhatsApp or text you here when a caller needs you."
          error={err("notification_phone")}
        >
          {(p) => (
            <Input {...p} name="notification_phone" type="tel" defaultValue={v?.notification_phone} autoComplete="tel" inputMode="tel" placeholder="0712 345 678" />
          )}
        </Field>

        {generalError ? (
          <p id="signup-error" role="alert" className="text-meta text-attention">
            {generalError}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className={`${btnPrimary} w-full gap-2`}>
          {pending ? <span aria-hidden="true" className={pendingSpinnerClass} /> : null}
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </>
  );
}
