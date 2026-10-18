"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updatePasswordAction, type ResetState } from "./actions";
import { Field, Input } from "@/components/ui/Field";
import { Button, ButtonLink } from "@/components/ui/Button";

const initial: ResetState = {};

export function ResetPasswordForm({ email }: { email?: string }) {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initial);
  const [show, setShow] = useState(false);
  // Controlled so a failed save doesn't wipe what was typed.
  const [form, setForm] = useState({ password: "", confirm: "" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.field) return;
    formRef.current?.querySelector<HTMLInputElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);

  if (state.expired) return <ResetLinkProblem expired />;

  const err = (f: ResetState["field"]) => (state.field === f ? state.error : undefined);
  const general = state.error && !state.field ? state.error : null;

  return (
    <>
      <h1 className="mt-8 text-display text-ink">Choose a new password</h1>
      {email ? (
        <p className="mt-2 text-body text-ink-2">
          For <span className="font-medium text-ink">{email}</span>
        </p>
      ) : null}
      <form ref={formRef} action={formAction} noValidate className="mt-6 space-y-4">
        {/* Lets password managers save the new password against the right account. */}
        {email ? <input type="email" name="username" value={email} autoComplete="username" readOnly hidden /> : null}
        <Field id="password" label="New password" hint="At least 8 characters." error={err("password")}>
          {(p) => (
            <div className="relative">
              <Input
                {...p}
                name="password"
                type={show ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                autoFocus
                className="pr-20"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-pressed={show}
                aria-controls="password confirm"
                className="absolute inset-y-0 right-1 my-auto h-11 rounded-lg px-3 text-meta font-medium text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          )}
        </Field>
        <Field id="confirm" label="Type it again" error={err("confirm")}>
          {(p) => (
            <Input
              {...p}
              name="confirm"
              type={show ? "text" : "password"}
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
              autoComplete="new-password"
              maxLength={72}
            />
          )}
        </Field>
        {general ? (
          <p role="alert" className="text-meta text-attention">
            {general}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block pending={pending}>
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </>
  );
}

/** Expired, used or opened-elsewhere links all land here with one way forward. */
export function ResetLinkProblem({ expired }: { expired: boolean }) {
  return (
    <section aria-labelledby="reset-link" className="mt-8">
      <h1 id="reset-link" className="text-display text-ink">
        {expired ? "This link has expired" : "This link doesn't work"}
      </h1>
      <p className="mt-3 text-body leading-relaxed text-ink-2">
        {expired
          ? "Reset links work once and expire after 1 hour. Send yourself a new one and open it on this device."
          : "It may have been used already, or opened in a different browser. Send yourself a new link and open it on this device."}
      </p>
      <div className="mt-6">
        <ButtonLink href="/forgot-password" variant="primary" size="lg" block>
          Send a new link
        </ButtonLink>
      </div>
    </section>
  );
}
