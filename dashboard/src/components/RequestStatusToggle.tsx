"use client";

import { useActionState } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { btnDock, btnDockGhost, deskHitClass } from "@/components/ui/deskChrome";

const initial: RequestStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function RequestStatusToggle({
  id,
  status,
  extra = false,
}: {
  id: string;
  status: string;
  extra?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateServiceRequestStatus,
    initial
  );

  const normalized = status === "fulfilled" || status === "cancelled" ? status : "open";
  const err = ownerError(state.error);
  const stack = extra
    ? "flex w-full flex-col items-end gap-2"
    : "flex items-center justify-end";

  return (
    <form action={formAction} className={extra ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <input type="hidden" name="id" value={id} />
      <div className={stack}>
        {normalized === "open" ? (
          <>
            <button
              type="submit"
              name="status"
              value="fulfilled"
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
        {normalized === "fulfilled" ? (
          <>
            <span className={`${btnDock} pointer-events-none bg-ok-soft text-ok shadow-none`}>
              Done
            </span>
            <button type="submit" name="status" value="open" disabled={pending} className={btnDockGhost}>
              Reopen
            </button>
          </>
        ) : null}
        {normalized === "cancelled" ? (
          <>
            <span className={`${deskHitClass} bg-surface-muted text-[11px] font-medium leading-none text-ink-soft`}>
              Cancelled
            </span>
            <button type="submit" name="status" value="open" disabled={pending} className={btnDockGhost}>
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
