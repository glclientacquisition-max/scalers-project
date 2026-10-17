"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useActionState, useEffect } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";
import { deskShiftClass } from "@/components/ui/deskChrome";

const OPTIONS = [
  { id: "requested", label: "Pending" },
  { id: "confirmed", label: "Confirmed" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const initial: AppointmentStatusState = {};

function AppointmentStatusToggleInner({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateAppointmentStatus,
    initial
  );

  useEffect(() => {
    if (state.error) console.warn("[AppointmentStatusToggle]", state.error);
  }, [state.error]);

  return (
    <form action={formAction} className="flex flex-wrap gap-1.5">
      <input type="hidden" name="id" value={id} />
      {OPTIONS.map((opt) => {
        const active = status === opt.id;
        return (
          <button
            key={opt.id}
            type="submit"
            name="status"
            value={opt.id}
            disabled={pending || active}
            className={[
              "rounded-lg border px-2.5 py-1 text-meta font-medium",
              deskShiftClass,
              active
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]/40",
              pending ? "opacity-60" : "",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
      {state.notice ? (
        <p className="basis-full text-caption text-ink-2" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}

export const AppointmentStatusToggle = withRoleGate("inbox.act", AppointmentStatusToggleInner);
