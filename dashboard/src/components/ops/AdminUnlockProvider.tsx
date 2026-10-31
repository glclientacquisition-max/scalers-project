"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { StepUpSheet } from "./StepUpSheet";
import { STEP_UP_UNLOCKED_EVENT } from "./useAdminUnlockSession";
import { STEP_UP_WHAT as WHAT } from "@/lib/ops/stepUpWords";

export const STEP_UP_EVENT = "scalers:step-up-required";

export type AdminUnlockOpen = {
  action: string;
  what: string;
  target?: string | null;
  observedHint?: string;
  replace?: boolean;
};

const AdminUnlockContext = createContext<(opts: AdminUnlockOpen) => void>(() => {});

export function useOpenAdminUnlock() {
  return useContext(AdminUnlockContext);
}

function isAdminApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const p = new URL(url, window.location.href).pathname;
    return p.startsWith("/api/admin") || p.startsWith("/api/did-pool");
  } catch {
    return false;
  }
}

type SheetState = AdminUnlockOpen & { open: boolean };

/**
 * One StepUpSheet for manual Unlock (header, UnlockCta, BusinessPane) and 403 step_up_required.
 * Sheet stays mounted so the first tap opens immediately with an in-sheet loading state.
 */
export function AdminUnlockProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const openUnlock = useCallback((opts: AdminUnlockOpen) => {
    setSheet({ ...opts, open: true });
  }, []);

  useEffect(() => {
    const w = window as Window & { __scalersStepUpFetch?: boolean };
    const onRequired = (e: Event) => {
      const action = String((e as CustomEvent<{ action?: string }>).detail?.action || "unlock");
      openUnlock({ action, what: WHAT[action] || "make this change" });
    };
    window.addEventListener(STEP_UP_EVENT, onRequired);
    if (!w.__scalersStepUpFetch) {
      w.__scalersStepUpFetch = true;
      const orig = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await orig(input, init);
        if (res.status === 403 && isAdminApi(input)) {
          res
            .clone()
            .json()
            .then((j: { error?: string; action?: string }) => {
              if (j?.error === "step_up_required") {
                window.dispatchEvent(new CustomEvent(STEP_UP_EVENT, { detail: { action: j.action || "unlock" } }));
              }
            })
            .catch(() => {});
        }
        return res;
      };
    }
    return () => window.removeEventListener(STEP_UP_EVENT, onRequired);
  }, [openUnlock]);

  const close = () => setSheet((s) => (s ? { ...s, open: false } : null));

  return (
    <AdminUnlockContext.Provider value={openUnlock}>
      {children}
      <StepUpSheet
        open={sheet?.open ?? false}
        onClose={close}
        action={sheet?.action ?? "unlock"}
        target={sheet?.target}
        what={sheet?.what ?? "make this change"}
        observedHint={sheet?.observedHint}
        replace={sheet?.replace}
        onObserved={() => {
          window.dispatchEvent(new CustomEvent(STEP_UP_UNLOCKED_EVENT));
        }}
      />
    </AdminUnlockContext.Provider>
  );
}
