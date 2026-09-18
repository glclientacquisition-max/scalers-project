"use client";

import { useActionState } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { btnDock, btnDockGhost, btnGhost, btnPrimary, pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: RequestStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function RequestStatusToggle({
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
    updateServiceRequestStatus,
    initial
  );

  const normalized = status === "fulfilled" || status === "cancelled" ? status : "open";
  const err = ownerError(state.error);
  const wide = extra || banner;
  const stack = wide
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <form action={formAction} className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <input type="hidden" name="id" value={id} />
      <div className={stack}>
        {normalized === "open" ? (
          <>
            <button
              type="submit"
              name="status"
              value="fulfilled"
              disabled={pending}
              className={wide ? `${btnPrimary} w-full` : btnDock}
              aria-label={pending ? "Saving" : "Done"}
            >
              {pending ? (
                wide ? (
                  "Saving"
                ) : (
                  <span aria-hidden="true" className={pendingSpinnerClass} />
                )
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
        {normalized === "fulfilled" ? (
          <>
            <span
              className={
                extra
                  ? "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ok-soft text-sm font-semibold text-ok"
                  : `${btnDock} pointer-events-none bg-ok-soft text-ok shadow-none`
              }
            >
              Done
            </span>
            {extra ? (
              <button
                type="submit"
                name="status"
                value="open"
                disabled={pending}
                className={`${btnGhost} w-full`}
              >
                Reopen
              </button>
            ) : null}
          </>
        ) : null}
        {normalized === "cancelled" ? (
          <>
            {extra ? (
              <span className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-surface-muted text-sm font-medium text-ink-soft">
                Cancelled
              </span>
            ) : null}
            <button
              type="submit"
              name="status"
              value="open"
              disabled={pending}
              className={extra ? `${btnGhost} w-full` : btnDockGhost}
            >
              Reopen
            </button>
          </>
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
