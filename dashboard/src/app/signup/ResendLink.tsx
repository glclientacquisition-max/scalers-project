"use client";

import { useActionState } from "react";
import { resendConfirmationAction, type ResendState } from "./actions";

const initial: ResendState = {};

/** "Didn't get it? Send again" for a known email. Server rate-limits; we only reflect the answer. */
export function ResendLink({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-3">
      <input type="hidden" name="email" value={email} />
      <p className="text-meta text-ink-2" role="status" aria-live="polite">
        {state.ok ? "Sent. Check your inbox and spam folder." : state.error ? state.error : "Didn't get it? Check spam, or send it again."}
      </p>
      <button
        type="submit"
        disabled={pending || state.ok}
        className="min-h-11 rounded-lg px-3 text-meta font-medium text-accent-deep hover:bg-accent-soft disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {pending ? "Sending…" : state.ok ? "Sent" : "Send again"}
      </button>
    </form>
  );
}
