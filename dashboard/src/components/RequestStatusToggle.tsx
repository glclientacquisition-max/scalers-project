"use client";

import { useActionState, useEffect } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";

const initial: RequestStatusState = {};

const primaryClass =
  "inline-flex min-h-9 items-center justify-center rounded-xl bg-[#0096FF] px-3 text-sm font-semibold text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] disabled:opacity-60";
const ghostClass =
  "inline-flex min-h-9 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] disabled:opacity-50";

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

  const normalized =
    status === "fulfilled" || status === "cancelled" ? status : "open";

  if (normalized === "fulfilled") {
    return (
      <div className="flex flex-wrap items-center gap-2">
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
            className={ghostClass}
          >
            Reopen
          </button>
        </form>
        {state.error ? (
          <p className="w-full text-xs text-warn">Could not update</p>
        ) : null}
      </div>
    );
  }

  if (normalized === "cancelled") {
    return (
      <div className="flex flex-wrap items-center gap-2">
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
            className={ghostClass}
          >
            Reopen
          </button>
        </form>
        {state.error ? (
          <p className="w-full text-xs text-warn">Could not update</p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        name="status"
        value="fulfilled"
        disabled={pending}
        className={primaryClass}
      >
        {pending ? "Saving" : "Done"}
      </button>
      <button
        type="submit"
        name="status"
        value="cancelled"
        disabled={pending}
        className={ghostClass}
      >
        Cancel
      </button>
      {state.error ? (
        <p className="w-full text-xs text-warn">Could not update</p>
      ) : null}
    </form>
  );
}
