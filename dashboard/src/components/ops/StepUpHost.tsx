"use client";

import { useEffect, useState } from "react";
import { StepUpSheet } from "./StepUpSheet";
import { STEP_UP_WHAT as WHAT } from "@/lib/ops/stepUpWords";


export const STEP_UP_EVENT = "scalers:step-up-required";

function isAdminApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const p = new URL(url, window.location.href).pathname;
    return p.startsWith("/api/admin") || p.startsWith("/api/did-pool");
  } catch {
    return false;
  }
}

/**
 * One catch-all so no gated button is ever dead: any admin write that comes back
 * 403 step_up_required opens the Unlock sheet for that action. After unlocking, tap the action again.
 * Mounted once in the Admin console layout.
 */
export function StepUpHost() {
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    const w = window as Window & { __scalersStepUpFetch?: boolean };
    const onEvent = (e: Event) => setAction(String((e as CustomEvent<{ action?: string }>).detail?.action || "unlock"));
    window.addEventListener(STEP_UP_EVENT, onEvent);
    if (!w.__scalersStepUpFetch) {
      w.__scalersStepUpFetch = true;
      const orig = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await orig(input, init);
        if (res.status === 403 && isAdminApi(input)) {
          res.clone().json().then((j: { error?: string; action?: string }) => {
            if (j?.error === "step_up_required") {
              window.dispatchEvent(new CustomEvent(STEP_UP_EVENT, { detail: { action: j.action || "unlock" } }));
            }
          }).catch(() => {});
        }
        return res;
      };
    }
    return () => window.removeEventListener(STEP_UP_EVENT, onEvent);
  }, []);

  return (
    <StepUpSheet
      open={action != null}
      onClose={() => setAction(null)}
      action={action || "unlock"}
      what={(action && WHAT[action]) || "make this change"}
    />
  );
}
