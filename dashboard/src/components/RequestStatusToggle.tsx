"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useActionState } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { Button } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";
import { holdDoneLabel } from "@/lib/inboxListVerbs";

const initial: RequestStatusState = {};

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

function RequestStatusToggleInner({
  id,
  status,
  extra = false,
  banner = false,
  requestType = null,
  vertical = null,
}: {
  id: string;
  status: string;
  extra?: boolean;
  banner?: boolean;
  /** service_requests.request_type: a callback or enquiry is "Mark done", a hold is "Hold Done". */
  requestType?: string | null;
  vertical?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateServiceRequestStatus,
    initial
  );

  const normalized = status === "fulfilled" || status === "cancelled" ? status : "open";
  const err = ownerError(state.error);
  const wide = extra || banner;
  const doneLabel = wide ? holdDoneLabel({ request_type: requestType }, vertical) : "Done";
  const stack = wide
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <form action={formAction} className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <input type="hidden" name="id" value={id} />
      <div className={stack}>
        {normalized === "open" ? (
          <>
            <Button
              type="submit"
              name="status"
              value="fulfilled"
              pending={pending}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pending ? "Saving" : doneLabel}
            >
              {pending ? "Saving" : doneLabel}
            </Button>
            {extra && !banner ? (
              <Button
                type="submit"
                name="status"
                value="cancelled"
                disabled={pending}
                variant="ghost"
                size="md"
                block
              >
                Cancel
              </Button>
            ) : null}
          </>
        ) : null}
        {normalized === "fulfilled" ? (
          <>
            {wide ? (
              <div className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ok-tonal">
                <Stamp tone="ok">Done</Stamp>
              </div>
            ) : (
              <Stamp tone="ok">Done</Stamp>
            )}
            {extra ? (
              <Button
                type="submit"
                name="status"
                value="open"
                disabled={pending}
                variant="ghost"
                size="md"
                block
              >
                Reopen
              </Button>
            ) : null}
          </>
        ) : null}
        {normalized === "cancelled" ? (
          <>
            {extra ? (
              <span className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-surface-2 text-body font-medium text-ink-2">
                Cancelled
              </span>
            ) : null}
            <Button
              type="submit"
              name="status"
              value="open"
              disabled={pending}
              variant="ghost"
              size={wide ? "md" : "sm"}
              block={Boolean(extra)}
            >
              Reopen
            </Button>
          </>
        ) : null}
      </div>
      {err ? (
        <p className="text-caption text-attention" role="alert">
          {err}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-caption text-ink-2" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}

export const RequestStatusToggle = withRoleGate("inbox.act", RequestStatusToggleInner);
