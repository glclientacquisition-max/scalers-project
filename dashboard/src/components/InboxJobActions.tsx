"use client";

import { useActionState } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { btnDock, btnDockGhost } from "@/components/ui/deskChrome";

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
    ? "flex w-full flex-col items-end gap-2"
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
              className={btnDock}
            >
              {pending ? "Saving" : "Confirm"}
            </button>
            {extra ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={btnDockGhost}
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
              className={btnDock}
            >
              {pending ? "Saving" : "Done"}
            </button>
            {extra ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={btnDockGhost}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : null}
        {normalized === "done" ? (
          <span className={`${btnDock} pointer-events-none bg-ok-soft text-ok shadow-none`}>
            Done
          </span>
        ) : null}
        {normalized === "cancelled" ? (
          <button type="submit" name="status" value="requested" disabled={pending} className={btnDockGhost}>
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
