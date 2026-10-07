"use client";

import { useActionState } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { Button } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";

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
            <Button
              type="submit"
              name="status"
              value="confirmed"
              pending={pending}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pending ? "Saving" : "Confirm"}
            >
              {pending ? "Saving" : "Confirm"}
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
        {normalized === "confirmed" ? (
          <>
            <Button
              type="submit"
              name="status"
              value="done"
              pending={pending}
              variant={wide ? "primary" : "tonal"}
              size={wide ? "md" : "sm"}
              block={wide}
              aria-label={pending ? "Saving" : "Done"}
            >
              {pending ? "Saving" : "Done"}
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
            type="submit"
            name="status"
            value="requested"
            disabled={pending}
            variant="ghost"
            size={wide ? "md" : "sm"}
            block={Boolean(extra)}
          >
            Reopen
          </Button>
        ) : null}
      </div>
      {err ? (
        <p className="text-caption text-attention" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}
