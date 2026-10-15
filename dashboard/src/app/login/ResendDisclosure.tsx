"use client";

import { useActionState, useState } from "react";
import { resendConfirmationAction, type ResendState } from "../signup/actions";
import { Field, Input } from "@/components/ui/Field";

const initial: ResendState = {};

/** For people whose confirmation link expired or never arrived. */
export function ResendDisclosure({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState(resendConfirmationAction, initial);
  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="resend-panel"
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 text-meta font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Didn&apos;t get a confirmation email?
      </button>
      {open ? (
        <form id="resend-panel" action={action} className="mt-2 space-y-3 rounded-2xl bg-surface p-4">
          <Field id="resend-email" label="Email you signed up with" error={state.error}>
            {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required />}
          </Field>
          {state.ok ? (
            <p role="status" className="text-meta text-ink-2">
              If that email has an account waiting for confirmation, a new link is on its way.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-surface-2 px-4 text-meta font-medium text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {pending ? "Sending…" : "Send a new link"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
