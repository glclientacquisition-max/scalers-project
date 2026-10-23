"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "./Drawer";

/**
 * Platform Unlock (s23/s24). One sheet for every sensitive Admin write.
 * Unlock proves the operator for the next write — it never changes domain state alone.
 * observe: Check access logs would-require-step-up. enforce: 501 + “Authenticator not set up yet” (#876 Q9).
 */
export function StepUpSheet({
  open, onClose, action, target, what, onObserved, observedHint,
}: {
  open: boolean;
  onClose: () => void;
  action: string;
  target?: string | null;
  what: string;
  onObserved?: () => void;
  observedHint?: string;
}) {
  const [state, setState] = useState<"idle" | "pending" | "observed" | "not_enrolled" | "error">("idle");
  const close = () => { setState("idle"); onClose(); };
  const check = async () => {
    setState("pending");
    try {
      const res = await fetch("/api/admin/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, target: target ?? null }),
      });
      if (res.status === 501) return setState("not_enrolled");
      if (!res.ok) return setState("error");
      setState("observed");
      onObserved?.();
    } catch {
      setState("error");
    }
  };
  return (
    <Drawer
      open={open}
      title="Unlock"
      dismissible={state !== "pending"}
      onOpenChange={(next) => { if (!next) close(); }}
      footer={
        <div className="flex w-full flex-col gap-ops-2" data-stepup-footer="">
          {state === "idle" ? (
            <p className="text-right text-ops-label text-ink-2" data-blocked-why="">Code entry arrives with authenticator setup.</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="md" onClick={close} disabled={state === "pending"}>
              {state === "observed" ? "Done" : "Cancel"}
            </Button>
            {state !== "observed" ? (
              <Button variant="primary" size="md" pending={state === "pending"} onClick={check} data-action="stepup-check">
                Check access
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="ops-theme flex flex-col gap-ops-3 text-ops-body text-ink" data-stepup-sheet="" data-action-key={action}>
        <p>
          Unlock lets you <span className="font-semibold">{what}</span>. It doesn&apos;t change anything by itself.
        </p>
        <label className="flex flex-col gap-1 border-t border-hairline pt-ops-3">
          <span className="text-ops-label font-semibold text-ink">Authenticator code</span>
          <input disabled inputMode="numeric" placeholder="6 digits — not set up yet" className="ops-field text-ink-2" data-field="code" aria-describedby="stepup-code-why" />
          <span id="stepup-code-why" className="text-ops-label text-ink-2">Not set up yet — waiting on the authenticator decision (#876 Q9).</span>
        </label>
        {state === "observed" ? (
          <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status" data-stepup-result="observed">
            Observe mode: logged that this would need a code. You can go ahead with the action as usual.
            {observedHint ? <span className="mt-1 block">{observedHint}</span> : null}
          </p>
        ) : null}
        {state === "not_enrolled" ? (
          <p className="text-ops-label text-attention" role="alert" data-stepup-result="not_enrolled">
            Authenticator not set up yet. Enforce needs enrolment — ask the owner to finish authenticator setup, or switch step-up back to observe.
          </p>
        ) : null}
        {state === "error" ? (
          <p className="text-ops-label text-attention" role="alert">Couldn&apos;t check access. Try again.</p>
        ) : null}
      </div>
    </Drawer>
  );
}
