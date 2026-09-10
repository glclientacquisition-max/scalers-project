"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentSchedule,
  type AppointmentScheduleState,
} from "@/app/(desk)/appointments/actions";
import { InboxJobActions } from "@/components/InboxJobActions";

const initial: AppointmentScheduleState = {};

const fieldClass =
  "w-full min-h-11 rounded-lg border border-line bg-white px-2.5 py-2 text-sm outline-none transition duration-150 hover:border-[#0096FF]/35 focus:border-[#0096FF] focus:outline-none focus:ring-2 focus:ring-[#0096FF]";

export function InboxJobEditor({
  id,
  status,
  whenText,
  landmark,
}: {
  id: string;
  status: string;
  whenText: string | null;
  landmark: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateAppointmentSchedule,
    initial
  );

  useEffect(() => {
    if (state.error) console.warn("[InboxJobEditor]", state.error);
  }, [state.error]);

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-xs font-medium text-ink-soft" htmlFor={`when-${id}`}>
          When
        </label>
        <input
          id={`when-${id}`}
          name="when_text"
          defaultValue={whenText || ""}
          placeholder="Tuesday 10:00 AM"
          className={fieldClass}
        />
        <label className="block text-xs font-medium text-ink-soft" htmlFor={`where-${id}`}>
          Where
        </label>
        <input
          id={`where-${id}`}
          name="address_landmark"
          defaultValue={landmark || ""}
          placeholder="Runda"
          className={fieldClass}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0096FF] px-4 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition duration-150 hover:bg-[#0088e8] active:bg-[#007ad1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? "Saving" : "Save"}
        </button>
        {state.error ? <p className="text-sm text-warn">{state.error}</p> : null}
      </form>
      <InboxJobActions id={id} status={status} />
    </div>
  );
}
