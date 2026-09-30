"use client";

import { useActionState } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import {
  btnDone,
  btnGhost,
  btnListConfirm,
  btnListDone,
  btnPrimary,
  pendingSpinnerClass,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";

const initial: AppointmentStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function InboxJobActions({
  id,
  status,
  extra = false,
  banner = false,
}: {
  id: string;
  status: string;
  extra?: boolean;
  banner?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateAppointmentStatus,
    initial
  );

  const normalized = ["requested", "confirmed", "done", "cancelled"].includes(status)
    ? status
    : "requested";
  const err = ownerError(state.error);
  const wide = extra || banner;
  const stack = wide
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <form action={formAction} className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <input type="hidden" name="id" value={id} />
      <div className={stack}>
        {normalized === "requested" ? (
          <>
            <button
              type="submit"
              name="status"
              value="confirmed"
              disabled={pending}
              className={wide ? `${btnPrimary} w-full` : btnListConfirm}
              aria-label={pending ? "Saving" : "Confirm"}
            >
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className={pendingSpinnerClass} />
                  Saving
                </span>
              ) : (
                "Confirm"
              )}
            </button>
            {extra && !banner ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={`${btnGhost} w-full`}
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
              className={wide ? `${btnDone} w-full` : btnListDone}
              aria-label={pending ? "Saving" : "Done"}
            >
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className={pendingSpinnerInkClass} />
                  Saving
                </span>
              ) : (
                "Done"
              )}
            </button>
            {extra && !banner ? (
              <button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                className={`${btnGhost} w-full`}
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
                : "inline-flex h-11 items-center justify-center rounded-xl bg-ok-soft px-3 text-sm font-semibold text-ok"
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
            className={extra ? `${btnGhost} w-full` : btnGhost}
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
