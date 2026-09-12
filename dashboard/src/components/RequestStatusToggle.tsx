"use client";

import { useActionState } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { btnGhost, btnPrimary } from "@/components/ui/deskChrome";

const initial: RequestStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

export function RequestStatusToggle({
  id,
  status,
  extra = true,
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

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {normalized === "open" ? (
          <>
            {extra ? (
              <button type="submit" name="status" value="cancelled" disabled={pending} className={`${btnGhost} disabled:opacity-50`}>
                Cancel
              </button>
            ) : null}
            <button type="submit" name="status" value="fulfilled" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
              {pending ? "Saving" : "Done"}
            </button>
          </>
        ) : null}
        {normalized === "fulfilled" ? (
          <>
            <span className="inline-flex min-h-11 items-center rounded-md bg-ok-soft px-3 text-sm font-medium text-ok">
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
