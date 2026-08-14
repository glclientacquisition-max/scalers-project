"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentStatus,
  type AppointmentStatusState,
} from "@/app/(desk)/appointments/actions";

const OPTIONS = [
  { id: "requested", label: "Requested" },
  { id: "confirmed", label: "Confirmed" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
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
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
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
    </form>
  );
}
