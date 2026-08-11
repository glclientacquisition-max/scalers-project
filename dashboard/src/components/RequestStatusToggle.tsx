"use client";

import { useActionState, useEffect } from "react";
import {
  updateServiceRequestStatus,
  type RequestStatusState,
} from "@/app/(desk)/requests/actions";

const OPTIONS = [
  { id: "open", label: "Open" },
  { id: "fulfilled", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const initial: RequestStatusState = {};

export function RequestStatusToggle({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateServiceRequestStatus,
    initial
  );

  useEffect(() => {
    if (state.error) console.warn("[RequestStatusToggle]", state.error);
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
