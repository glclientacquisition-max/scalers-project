"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";

const initial: AppointmentStatusState = {};

const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0096FF] px-4 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition duration-150 hover:bg-[#0088e8] active:bg-[#007ad1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2 disabled:opacity-60";

const btnGhost =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-ink-soft transition duration-150 hover:bg-surface-muted hover:text-ink active:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] disabled:opacity-50";

export function InboxJobActions({
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
    if (state.error) console.warn("[InboxJobActions]", state.error);
  }, [state.error]);

  const normalized = ["requested", "confirmed", "done", "cancelled"].includes(status)
    ? status
    : "requested";

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="id" value={id} />
      {normalized === "requested" ? (
        <>
          <button type="submit" name="status" value="confirmed" disabled={pending} className={btnPrimary}>
            {pending ? "Saving" : "Confirm"}
          </button>
          <button type="submit" name="status" value="cancelled" disabled={pending} className={btnGhost}>
            Cancel
          </button>
        </>
      ) : null}
      {normalized === "confirmed" ? (
        <>
          <button type="submit" name="status" value="done" disabled={pending} className={btnPrimary}>
            {pending ? "Saving" : "Done"}
          </button>
          <button type="submit" name="status" value="cancelled" disabled={pending} className={btnGhost}>
            Cancel
          </button>
        </>
      ) : null}
      {normalized === "done" ? (
        <span className="rounded-md bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">Done</span>
      ) : null}
      {normalized === "cancelled" ? (
        <button type="submit" name="status" value="requested" disabled={pending} className={btnGhost}>
          Reopen
        </button>
      ) : null}
    </form>
  );
}
