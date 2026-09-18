"use client";

import { useActionState } from "react";
import {
  updateServiceRequestSchedule,
  type RequestScheduleState,
} from "@/app/(desk)/requests/actions";
import { btnGhost, deskFieldClass } from "@/components/ui/deskChrome";

const initial: RequestScheduleState = {};

const fieldClass = deskFieldClass;

export function InboxHoldEditor({
  id,
  whenText,
}: {
  id: string;
  whenText: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateServiceRequestSchedule,
    initial
  );

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-xs font-medium text-ink-soft" htmlFor={`hold-when-${id}`}>
          When
        </label>
        <input
          id={`hold-when-${id}`}
          name="when_text"
          defaultValue={whenText || ""}
          placeholder="Today 5:00 PM"
          className={fieldClass}
        />
        <button
          type="submit"
          disabled={pending}
          className={`${btnGhost} w-full disabled:opacity-50`}
        >
          {pending ? "Saving" : "Save"}
        </button>
        {state.error ? <p className="text-sm text-warn">Could not save.</p> : null}
      </form>
    </div>
  );
}
