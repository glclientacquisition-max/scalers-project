"use client";

import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { LeadStatus } from "@/lib/supabase";

const TRIAGE_STEPS: { id: Exclude<LeadStatus, "archived">; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Followed Up" },
  { id: "resolved", label: "Done" },
];

const STYLES: Record<
  Exclude<LeadStatus, "archived">,
  { active: string; idle: string }
> = {
  new: {
    active: "bg-warn text-white border-warn",
    idle: "border-line text-ink-soft hover:border-warn/60",
  },
  contacted: {
    active: "bg-lead text-white border-lead",
    idle: "border-line text-ink-soft hover:border-lead/60",
  },
  resolved: {
    active: "bg-ok text-white border-ok",
    idle: "border-line text-ink-soft hover:border-ok/60",
  },
};

export function LeadStatusToggle({
  callId,
  initial,
  size = "sm",
}: {
  callId: string;
  initial: LeadStatus;
  size?: "sm" | "md";
}) {
  const [status, setStatus] = useState<LeadStatus>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function select(next: LeadStatus) {
    if (next === status || pending) return;
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const res = await updateLeadStatus(callId, next);
      if (!res.ok) {
        setStatus(previous);
        setError(res.error || "Could not update.");
      }
    });
  }

  const pad = size === "md" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  const activeStep =
    status === "archived" ? null : (status as Exclude<LeadStatus, "archived">);

  return (
    <div>
      <div
        className={["inline-flex flex-wrap items-center gap-1", pending ? "opacity-60" : ""].join(
          " "
        )}
        role="group"
        aria-label="Lead status"
      >
        {TRIAGE_STEPS.map((step) => {
          const active = activeStep === step.id;
          return (
            <button
              key={step.id}
              type="button"
              disabled={pending}
              onClick={() => select(step.id)}
              aria-pressed={active}
              className={[
                "rounded-full border font-medium transition",
                pad,
                active ? STYLES[step.id].active : STYLES[step.id].idle,
              ].join(" ")}
            >
              {step.label}
            </button>
          );
        })}
        {status === "archived" ? (
          <span
            className={[
              "rounded-full border border-line bg-surface-muted font-medium text-ink-soft",
              pad,
            ].join(" ")}
          >
            Archived
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-1.5 text-xs text-warn">{error}</p> : null}
    </div>
  );
}
