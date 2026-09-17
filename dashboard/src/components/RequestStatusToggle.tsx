"use client";

import { useActionState } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { btnDock, btnGhost, btnPrimary } from "@/components/ui/deskChrome";

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
    ? "flex w-full flex-col items-stretch gap-2"
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
                className={`${btnGhost} w-full disabled:opacity-50`}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : null}
        {normalized === "fulfilled" ? (
          <>
            <span className="inline-flex h-11 w-24 shrink-0 items-center justify-center rounded-xl bg-ok-soft text-sm font-medium text-ok">
              Done
            </span>
            <button type="submit" name="status" value="open" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
              Reopen
            </button>
          </>
        ) : null}
        {normalized === "cancelled" ? (
          <>
            <span className="inline-flex min-h-11 items-center rounded-md bg-surface-muted px-3 text-sm font-medium text-ink-soft">
              Cancelled
            </span>
            <button type="submit" name="status" value="open" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
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
