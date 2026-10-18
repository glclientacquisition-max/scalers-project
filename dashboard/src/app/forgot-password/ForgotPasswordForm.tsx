"use client";

import { useActionState, useState } from "react";
import { requestPasswordResetAction, type ForgotState } from "./actions";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const initial: ForgotState = {};

export function ForgotPasswordForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initial);
  const [email, setEmail] = useState(defaultEmail);
  const [again, setAgain] = useState(false);

  if (state.sent && !again) {
    return (
      <section aria-labelledby="reset-sent" className="mt-8" role="status">
        <h1 id="reset-sent" className="text-display text-ink">
          Check your email
        </h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">
          If <span className="font-medium text-ink">{state.email}</span> has a Scalers account, we sent it a link to
          choose a new password. The link works once and expires in 1 hour.
        </p>
        <p className="mt-3 text-body leading-relaxed text-ink-2">Nothing there after a few minutes? Check your spam folder.</p>
        <p className="mt-6 text-meta text-ink-2">
          Wrong email, or no email yet?{" "}
          <button
            type="button"
            onClick={() => setAgain(true)}
            className="min-h-11 font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Send another link
          </button>
        </p>
      </section>
    );
  }

  return (
    <>
      <h1 className="mt-8 text-display text-ink">Reset your password</h1>
      <p className="mt-2 text-body text-ink-2">Enter the email you sign in with. We&apos;ll send you a link to choose a new password.</p>
      <form action={(fd) => { setAgain(false); return formAction(fd); }} noValidate className="mt-6 space-y-4">
        <Field id="email" label="Email" error={state.error}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block pending={pending}>
          {pending ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </>
  );
}
