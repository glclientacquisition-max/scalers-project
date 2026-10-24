"use client";

import { useEffect, useState } from "react";
import { StepUpSheet } from "./StepUpSheet";

/** Plain-language names for gate keys (adminRouteRegistry in stepUpCore). Unknown keys fall back to "make this change". */
const WHAT: Record<string, string> = {
  "buy-number:buy": "buy this number",
  "voices:delete": "delete this voice",
  "did-pool:release": "release this number",
  "did-pool:assign_specific": "assign this number",
  "did-pool:assign_next": "assign the next free number",
  "businesses:release_did": "release this business's number",
  "businesses:archive": "archive this business",
  "businesses:transfer_owner": "transfer the owner",
  "businesses:assign_next": "assign a number",
  "invoice:void": "void this invoice",
  "invoice:credit_note": "issue a credit note",
  "number-hold:hold": "hold this number",
  "number-hold:end_hold": "end the hold",
  "number-hold:restore": "restore this number",
  "number-hold:set_settings": "save hold settings",
  "number-hold:bill_fee": "bill the reactivation fee",
  "package-versions:publish": "publish this package",
  "package-versions:move_subscribers": "move subscribers",
  "package-versions:set_billing_mode": "change the billing mode",
  "billing:grant_minutes": "grant minutes",
  "billing:assign_package": "assign a package",
  "billing:resolve_checkout_review": "resolve this checkout review",
  "billing:set_billing_mode": "change the billing mode",
  "wallets:set_billing_mode": "change the billing mode",
  "platform-ops:save_settings": "save platform settings",
  "step-up:reset": "reset another operator's authenticator",
  "step-up:regenerate_backup_codes": "make new backup codes",
};

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
