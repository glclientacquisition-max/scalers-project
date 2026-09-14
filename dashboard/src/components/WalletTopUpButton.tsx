"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initiateWalletTopUp,
  type WalletTopUpState,
} from "@/app/(desk)/wallet/topupActions";
import { WALLET_TOPUP_PRESETS_KES } from "@/lib/walletTopUp";
import { btnPrimary, pendingSpinnerClass } from "@/components/ui/deskChrome";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { settingsChipClass } from "@/components/settingsUi";

const initial: WalletTopUpState = {};

export function WalletTopUpButton({
  tenantId,
  topUpEnabled,
  presets = WALLET_TOPUP_PRESETS_KES,
}: {
  tenantId: string;
  topUpEnabled: boolean;
  presets?: readonly number[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(presets[1] ?? 1000);
  const [state, formAction, pending] = useActionState(initiateWalletTopUp, initial);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = window.setTimeout(() => setOpen(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [state.ok, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        Top up
      </button>

      {open ? (
        <DeskDialog title="Top up prepaid" onClose={close} pending={pending}>
          <p className="mt-1 text-sm text-ink-soft">
            {topUpEnabled
              ? "Choose an amount. Payment credits your prepaid balance."
              : "Online top-up is not live on this workspace."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((preset) => {
              const active = amount === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={settingsChipClass(active)}
                >
                  KES {preset.toLocaleString("en-KE")}
                </button>
              );
            })}
          </div>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="amount_kes" value={String(amount)} />

            {state.error ? (
              <p className="text-sm text-warn" role="alert">
                {state.error}
              </p>
            ) : null}
            {state.ok && state.message ? (
              <p className="text-sm text-ok" role="status">
                {state.message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending || !topUpEnabled}
              className={`${btnPrimary} w-full gap-2`}
            >
              {pending ? (
                <>
                  <span aria-hidden="true" className={pendingSpinnerClass} />
                  Starting
                </>
              ) : topUpEnabled ? (
                `Pay KES ${amount.toLocaleString("en-KE")}`
              ) : (
                "Top up not live yet"
              )}
            </button>
          </form>
        </DeskDialog>
      ) : null}
    </>
  );
}
