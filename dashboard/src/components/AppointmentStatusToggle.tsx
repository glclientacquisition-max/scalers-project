"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";

const initial: AppointmentStatusState = {};

export function AppointmentStatusToggle({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateAppointmentStatus,
    initial
  );

  useEffect(() => {
    if (state.error) console.warn("[AppointmentStatusToggle]", state.error);
  }, [state.error]);

  const normalized =
    status === "confirmed" || status === "done" || status === "cancelled"
      ? status
      : "requested";

  if (normalized === "done") {
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
            value="requested"
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
            value="requested"
            disabled={pending}
            className="text-xs font-medium text-ink-soft underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50"
          >
            Reopen
          </button>
        </form>
      </div>
    );
  }

  const primaryValue = normalized === "requested" ? "confirmed" : "done";
  const primaryLabel = normalized === "requested" ? "Confirm" : "Done";

  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2 sm:items-end">
      <input type="hidden" name="id" value={id} />
      {normalized === "confirmed" ? (
        <p className="text-xs font-medium text-ok">Confirmed</p>
      ) : null}
      <button
        type="submit"
        name="status"
        value={primaryValue}
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0096FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? "Saving…" : primaryLabel}
      </button>
      <button
        type="submit"
        name="status"
        value="cancelled"
        disabled={pending}
        className="inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}
