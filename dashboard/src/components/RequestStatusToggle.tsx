"use client";

import { useActionState, useEffect } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";

const initial: RequestStatusState = {};

export function RequestStatusToggle({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateServiceRequestStatus,
    initial
  );

  useEffect(() => {
    if (state.error) console.warn("[RequestStatusToggle]", state.error);
  }, [state.error]);

  const normalized = status === "fulfilled" || status === "cancelled" ? status : "open";

  if (normalized === "fulfilled") {
    return (
      <div className="flex flex-col items-end gap-2">
        <span className="rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
          Done
        </span>
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            name="status"
            value="open"
            disabled={pending}
            className="text-xs font-medium text-ink-soft underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50"
          >
            Reopen
          </button>
        </form>
      </div>
    );
  }

  if (normalized === "cancelled") {
    return (
      <div className="flex flex-col items-end gap-2">
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-soft">
          Cancelled
        </span>
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            name="status"
            value="open"
            disabled={pending}
            className="text-xs font-medium text-ink-soft underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50"
          >
            Reopen
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2 sm:items-end">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        name="status"
        value="fulfilled"
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0096FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Done"}
      </button>
      <button
        type="submit"
        name="status"
        value="cancelled"
        disabled={pending}
        className="inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/30 disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}
