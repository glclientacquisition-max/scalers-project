"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initiateWalletTopUp,
  type WalletTopUpState,
} from "@/app/(desk)/wallet/topupActions";
import { WALLET_TOPUP_PRESETS_KES } from "@/lib/walletTopUp";

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

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = window.setTimeout(() => setOpen(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [state.ok, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[3.25rem] items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2"
      >
        Top up
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          role="presentation"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="wallet-topup-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="wallet-topup-title"
                  className="font-display text-xl tracking-tight text-ink"
                >
                  Top up prepaid
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {topUpEnabled
                    ? "Choose an amount. Payment credits your prepaid balance."
                    : "Online top-up activates when M-Pesa is enabled on this environment."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-ink-soft hover:bg-surface-canvas hover:text-ink"
                aria-label="Close"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {presets.map((preset) => {
                const active = amount === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={[
                      "rounded-xl border px-3 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                      active
                        ? "border-[#0096FF] bg-[#0096FF]/10 text-[#005ccc]"
                        : "border-line text-ink hover:border-[#0096FF]/45",
                    ].join(" ")}
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
                className="inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0088e8] disabled:opacity-60"
              >
                {pending
                  ? "Starting…"
                  : topUpEnabled
                    ? `Pay KES ${amount.toLocaleString("en-KE")}`
                    : "Top up not live yet"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
