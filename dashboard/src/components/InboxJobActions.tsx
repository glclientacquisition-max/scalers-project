"use client";

import { useActionState } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { btnDock, btnDockGhost, btnGhost, btnPrimary } from "@/components/ui/deskChrome";

const initial: AppointmentStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function InboxJobActions({
  id,
  status,
  extra = false,
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
  const stack = extra
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <form action={formAction} className={extra ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <input type="hidden" name="id" value={id} />
      <div className={stack}>
        {normalized === "requested" ? (
          <>
            <button
              type="submit"
              name="status"
              value="confirmed"
              disabled={pending}
              className={extra ? `${btnPrimary} w-full` : btnDock}
            >
              {pending ? "Saving" : "Confirm"}
            </button>
            {extra ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={extra ? `${btnGhost} w-full` : btnDockGhost}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : null}
        {normalized === "confirmed" ? (
          <>
            <button
              type="submit"
              name="status"
              value="done"
              disabled={pending}
              className={extra ? `${btnPrimary} w-full` : btnDock}
            >
              {pending ? "Saving" : "Done"}
            </button>
            {extra ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={extra ? `${btnGhost} w-full` : btnDockGhost}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : null}
        {normalized === "done" ? (
          <span
            className={
              extra
                ? "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ok-soft text-sm font-semibold text-ok"
                : `${btnDock} pointer-events-none bg-ok-soft text-ok shadow-none`
            }
          >
            Done
          </span>
        ) : null}
        {normalized === "cancelled" ? (
          <button
            type="submit"
            name="status"
            value="requested"
            disabled={pending}
            className={extra ? `${btnGhost} w-full` : btnDockGhost}
          >
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
