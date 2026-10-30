"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useRef, useState, useTransition } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";
import { Button } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";
import { holdDoneLabel } from "@/lib/inboxListVerbs";

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
  const [override, setOverride] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [state, setState] = useState<RequestStatusState>({});
  const [, startQuiet] = useTransition();
  const token = useRef(0);
  const shown = pendingValue ? status : (override ?? status);
  const normalized = shown === "fulfilled" || shown === "cancelled" ? shown : "open";

  function choose(next: string) {
    if (next === normalized || pendingValue === next) return;
    const mine = ++token.current;
    setPendingValue(next);
    const data = new FormData();
    data.set("id", id);
    data.set("status", next);
    startQuiet(async () => {
      let res: RequestStatusState;
      try {
        res = await updateServiceRequestStatus({}, data);
      } catch {
        res = { error: "Could not save." };
      }
      if (token.current !== mine) return;
      setPendingValue(null);
      setState(res);
      if (!res.error) setOverride(next);
    });
  }
  const err = ownerError(state.error);
  const wide = extra || banner;
  const doneLabel = wide ? holdDoneLabel({ request_type: requestType }, vertical) : "Done";
  const stack = wide
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <div className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"} data-request-actions={id} data-row-pending={pendingValue ? "1" : "0"}>
      <div className={stack}>
        {normalized === "open" ? (
          <>
            <Button
              type="button"
              pending={pendingValue === "fulfilled"}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pendingValue === "fulfilled" ? "Saving" : doneLabel}
              onClick={() => choose("fulfilled")}
            >
              {pendingValue === "fulfilled" ? "Saving" : doneLabel}
            </Button>
            {extra && !banner ? (
              <Button
                type="button"
                pending={pendingValue === "cancelled"}
                variant="ghost"
                size="md"
                block
                onClick={() => choose("cancelled")}
              >
                {pendingValue === "cancelled" ? "Saving" : "Cancel"}
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
                type="button"
                pending={pendingValue === "open"}
                variant="ghost"
                size="md"
                block
                onClick={() => choose("open")}
              >
                {pendingValue === "open" ? "Saving" : "Reopen"}
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
              type="button"
              pending={pendingValue === "open"}
              variant="ghost"
              size={wide ? "md" : "sm"}
              block={Boolean(extra)}
              onClick={() => choose("open")}
            >
              {pendingValue === "open" ? "Saving" : "Reopen"}
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
    </div>
  );
}

export const RequestStatusToggle = withRoleGate("inbox.act", RequestStatusToggleInner);
