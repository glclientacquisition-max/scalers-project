"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "./Drawer";

/**
 * Platform Unlock (s23). One sheet for every sensitive Admin write.
 * Unlock proves the operator for the next write — it never changes a number, package or switch itself.
 * Code entry waits on issue 876 Q9 (authenticator choice); until then the sheet says so plainly.
 */
export function StepUpSheet({
  open, onClose, action, target, what,
}: {
  open: boolean;
  onClose: () => void;
  /** Machine action key, e.g. "numbers:archive_release". */
  action: string;
  /** e164 or business id — never a secret. */
  target?: string | null;
  /** Plain words: what this unlock would allow. */
  what: string;
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
          <span id="stepup-code-why" className="text-ops-label text-ink-2">Not set up yet — waiting on the authenticator decision.</span>
        </label>
        {state === "observed" ? (
          <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status" data-stepup-result="observed">
            Observe mode: logged that this would need a code. You can go ahead with the action as usual.
          </p>
        ) : null}
        {state === "not_enrolled" ? (
          <p className="text-ops-label text-attention" role="alert" data-stepup-result="not_enrolled">
            Secure sign-in is required but no authenticator is set up yet. Ask the owner to switch step-up back to observe.
          </p>
        ) : null}
        {state === "error" ? (
          <p className="text-ops-label text-attention" role="alert">Couldn&apos;t check access. Try again.</p>
        ) : null}
      </div>
    </Drawer>
  );
}
