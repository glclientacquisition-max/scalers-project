"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useRef, useState, useTransition } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { Button } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";

function ownerError(error?: string) {
  if (!error) return null;
  return "Could not save.";
}

function InboxJobActionsInner({
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
  const [override, setOverride] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [state, setState] = useState<AppointmentStatusState>({});
  const [, startQuiet] = useTransition();
  const token = useRef(0);
  const shown = pendingValue ? status : (override ?? status);
  const normalized = ["requested", "confirmed", "done", "cancelled"].includes(shown)
    ? shown
    : "requested";

  function choose(next: string) {
    if (next === normalized || pendingValue === next) return;
    const mine = ++token.current;
    setPendingValue(next);
    const data = new FormData();
    data.set("id", id);
    data.set("status", next);
    startQuiet(async () => {
      let res: AppointmentStatusState;
      try {
        res = await updateAppointmentStatus({}, data);
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
  const stack = wide
    ? "flex w-full flex-col gap-2"
    : "flex items-center justify-end";

  return (
    <div className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"} data-job-actions={id} data-row-pending={pendingValue ? "1" : "0"}>
      <div className={stack}>
        {normalized === "requested" ? (
          <>
            <Button
              type="button"
              pending={pendingValue === "confirmed"}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pendingValue === "confirmed" ? "Saving" : "Confirm"}
              onClick={() => choose("confirmed")}
            >
              {pendingValue === "confirmed" ? "Saving" : "Confirm"}
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
        {normalized === "confirmed" ? (
          <>
            <Button
              type="button"
              pending={pendingValue === "done"}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pendingValue === "done" ? "Saving" : "Done"}
              onClick={() => choose("done")}
            >
              {pendingValue === "done" ? "Saving" : "Done"}
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
        {normalized === "done" ? (
          wide ? (
            <div className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ok-tonal">
              <Stamp tone="ok">Done</Stamp>
            </div>
          ) : (
            <Stamp tone="ok">Done</Stamp>
          )
        ) : null}
        {normalized === "cancelled" ? (
          <Button
            type="button"
            pending={pendingValue === "requested"}
            variant="ghost"
            size={wide ? "md" : "sm"}
            block={Boolean(extra)}
            onClick={() => choose("requested")}
          >
            {pendingValue === "requested" ? "Saving" : "Reopen"}
          </Button>
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

export const InboxJobActions = withRoleGate("inbox.act", InboxJobActionsInner);
