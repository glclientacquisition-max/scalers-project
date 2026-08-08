"use client";

import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { LeadStatus } from "@/lib/supabase";

const STEPS: { id: LeadStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "resolved", label: "Resolved" },
];

const STYLES: Record<LeadStatus, { active: string; idle: string }> = {
  new: {
    active: "bg-[var(--warn)] text-white border-[var(--warn)]",
    idle: "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--warn)]/60",
  },
  contacted: {
    active: "bg-lead text-white border-lead",
    idle: "border-line text-ink-soft hover:border-lead/60",
  },
  resolved: {
    active: "bg-[var(--ok)] text-white border-[var(--ok)]",
    idle: "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ok)]/60",
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

  return (
    <div>
      <div
        className={["inline-flex items-center gap-1", pending ? "opacity-60" : ""].join(" ")}
        role="group"
        aria-label="Lead status"
      >
        {STEPS.map((step) => {
          const active = status === step.id;
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
      </div>
      {error ? <p className="mt-1.5 text-xs text-[var(--warn)]">{error}</p> : null}
    </div>
  );
}
