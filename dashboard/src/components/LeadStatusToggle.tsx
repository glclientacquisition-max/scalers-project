"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useRef, useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { LeadStatus } from "@/lib/supabase";
import { pendingDotClass } from "@/components/ui/Button";
import { deskShiftClass } from "@/components/ui/deskChrome";

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
    active: "bg-warn text-accent-on-fill border-warn",
    idle: "border-hairline text-ink-2 hover:border-warn/60",
  },
  contacted: {
    active: "bg-lead text-accent-on-fill border-lead",
    idle: "border-hairline text-ink-2 hover:border-lead/60",
  },
  resolved: {
    active: "bg-ok text-accent-on-fill border-ok",
    idle: "border-hairline text-ink-2 hover:border-ok/60",
  },
};

function LeadStatusToggleInner({
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
  const [pendingStep, setPendingStep] = useState<LeadStatus | null>(null);
  const [, startQuiet] = useTransition();
  const token = useRef(0);

  function select(next: LeadStatus) {
    if (next === status) return;
    const previous = status;
    const mine = ++token.current;
    setStatus(next);
    setPendingStep(next);
    setError(null);
    startQuiet(async () => {
      const res = await updateLeadStatus(callId, next);
      if (token.current !== mine) return;
      setPendingStep(null);
      if (!res.ok) {
        setStatus(previous);
        setError(res.error || "Could not update.");
      }
    });
  }

  const pad = size === "md" ? "px-3.5 py-1.5 text-body" : "px-2.5 py-1 text-meta";
  const activeStep =
    status === "archived" ? null : (status as Exclude<LeadStatus, "archived">);

  return (
    <div>
      <div
        className="inline-flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Lead status"
      >
        {TRIAGE_STEPS.map((step) => {
          const active = activeStep === step.id;
          const pending = pendingStep === step.id;
          return (
            <button
              key={step.id}
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              data-row-pending={pending ? "1" : "0"}
              onClick={() => select(step.id)}
              aria-pressed={active}
              className={[
                "inline-flex items-center gap-1 rounded-full border font-medium",
                deskShiftClass,
                pad,
                active ? STYLES[step.id].active : STYLES[step.id].idle,
              ].join(" ")}
            >
              {pending ? <span aria-hidden="true" className={pendingDotClass} /> : null}
              {step.label}
            </button>
          );
        })}
        {status === "archived" ? (
          <span
            className={[
              "rounded-full border border-hairline bg-surface-muted font-medium text-ink-2",
              pad,
            ].join(" ")}
          >
            Archived
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-1.5 text-meta text-warn">{error}</p> : null}
    </div>
  );
}

export const LeadStatusToggle = withRoleGate("inbox.act", LeadStatusToggleInner);
