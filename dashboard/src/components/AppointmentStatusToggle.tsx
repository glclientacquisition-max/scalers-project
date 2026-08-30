"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";

const OPTIONS = [
  { id: "requested", label: "Requested", active: "border-warn bg-warn text-white" },
  { id: "confirmed", label: "Confirmed", active: "border-lead bg-lead text-white" },
  { id: "done", label: "Done", active: "border-ok bg-ok text-white" },
  { id: "cancelled", label: "Cancelled", active: "border-line bg-surface-muted text-ink-soft" },
] as const;

const initial: AppointmentStatusState = {};

export function AppointmentStatusToggle({
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
    <div>
      <form
        action={formAction}
        className="inline-flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Appointment status"
      >
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
              aria-pressed={active}
              className={[
                "rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]",
                active
                  ? opt.active
                  : "border-line text-ink-soft hover:border-[#0096FF]/60",
                pending ? "opacity-60" : "",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </form>
      {state.error ? (
        <p className="mt-1.5 text-xs text-warn">Could not update</p>
      ) : null}
    </div>
  );
}
