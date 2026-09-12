"use client";

import { useActionState } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { btnGhost, btnPrimary } from "@/components/ui/deskChrome";

const initial: AppointmentStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function InboxJobActions({
  id,
  status,
  extra = true,
}: {
  id: string;
  status: string;
  extra?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateAppointmentStatus,
    initial
  );

  const normalized = ["requested", "confirmed", "done", "cancelled"].includes(status)
    ? status
    : "requested";
  const err = ownerError(state.error);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {normalized === "requested" ? (
          <>
            {extra ? (
              <button type="submit" name="status" value="cancelled" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
                Cancel
              </button>
            ) : null}
            <button type="submit" name="status" value="confirmed" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
              {pending ? "Saving" : "Confirm"}
            </button>
          </>
        ) : null}
        {normalized === "confirmed" ? (
          <>
            {extra ? (
              <button type="submit" name="status" value="cancelled" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
                Cancel
              </button>
            ) : null}
            <button type="submit" name="status" value="done" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
              {pending ? "Saving" : "Done"}
            </button>
          </>
        ) : null}
        {normalized === "done" ? (
          <span className="inline-flex min-h-11 items-center rounded-md bg-ok-soft px-3 text-sm font-medium text-ok">
            Done
          </span>
        ) : null}
        {normalized === "cancelled" ? (
          <button type="submit" name="status" value="requested" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
            Reopen
          </button>
        ) : null}
      </div>
      {err ? (
        <p className="text-xs text-warn" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}
