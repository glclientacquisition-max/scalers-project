"use client";

import { useActionState, useEffect } from "react";
import {
  updateAppointmentSchedule,
  type AppointmentScheduleState,
} from "@/app/(desk)/appointments/actions";
import { InboxJobActions } from "@/components/InboxJobActions";
import { btnGhost, deskFieldClass } from "@/components/ui/deskChrome";

const initial: AppointmentScheduleState = {};

const fieldClass = deskFieldClass;

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
          className={`${btnGhost} w-full disabled:opacity-50`}
        >
          {pending ? "Saving" : "Save"}
        </button>
        {state.error ? <p className="text-sm text-warn">{state.error}</p> : null}
      </form>
      <InboxJobActions id={id} status={status} extra />
    </div>
  );
}
