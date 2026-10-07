"use client";

import { useActionState } from "react";
import {
  updateServiceRequestSchedule,
  type RequestScheduleState,
} from "@/app/(desk)/requests/actions";
import { Button } from "@/components/ui/Button";
import { deskFieldClass } from "@/components/ui/deskChrome";

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
      <form action={formAction} data-pull-dirty-guard="" className="space-y-2">
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
        <Button type="submit" variant="ghost" size="md" block pending={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
        {state.error ? <p className="text-sm text-warn">Could not save.</p> : null}
      </form>
    </div>
  );
}
