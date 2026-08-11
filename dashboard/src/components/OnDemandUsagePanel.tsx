"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WALLET_LOW_BALANCE_KES } from "@/lib/wallet";
import {
  saveOnDemandUsage,
  type OnDemandUsageState,
} from "@/app/(desk)/wallet/actions";

const initial: OnDemandUsageState = {};

export function OnDemandUsagePanel({
  tenantId,
  enabled: initialEnabled,
  walletBalanceKes,
  isBeta,
  lowThresholdKes = WALLET_LOW_BALANCE_KES,
}: {
  tenantId: string;
  enabled: boolean;
  walletBalanceKes: number;
  isBeta: boolean;
  lowThresholdKes?: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveOnDemandUsage, initial);
  const [enabled, setEnabled] = useState(initialEnabled);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const prepaidEmpty = !isBeta && walletBalanceKes <= 0;
  const prepaidLow =
    !isBeta && walletBalanceKes > 0 && walletBalanceKes < lowThresholdKes;

  return (
    <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Prepaid & on-demand</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)] max-w-xl leading-relaxed">
            Your paid wallet balance covers calls first. When it runs low or empty, we send you a
            live WhatsApp/email alert automatically — you do not set a soft limit.
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg-deep)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)]">
          {enabled ? "On-demand on" : "On-demand off"}
        </span>
      </div>

      {isBeta ? (
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          Free beta: usage is metered only (not charged), so prepaid alerts stay quiet until Scalers
          graduates this workspace to prepaid.
        </p>
      ) : (
        <ul className="mt-4 space-y-2 text-sm text-[var(--ink-soft)]">
          <li>
            Automatic alert under{" "}
            <span className="font-medium text-[var(--ink)]">
              KES {lowThresholdKes.toLocaleString("en-KE")}
            </span>{" "}
            and again at empty.
          </li>
          <li>
            Current prepaid:{" "}
            <span
              className={
                prepaidEmpty || prepaidLow
                  ? "font-medium text-[var(--warn)]"
                  : "font-medium text-[var(--ink)]"
              }
            >
              KES {walletBalanceKes.toLocaleString("en-KE")}
            </span>
            {prepaidEmpty ? " — empty" : prepaidLow ? " — running low" : null}
          </li>
        </ul>
      )}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isBeta}
          />
          <span>
            <span className="font-medium text-[var(--ink)]">Enable on-demand usage</span>
            <span className="block text-[var(--ink-soft)]">
              When prepaid hits zero, keep answering calls and bill beyond your paid balance (like
              Cursor on-demand). Leave off to pause further charges until you top up.
            </span>
          </span>
        </label>

        {state.error ? <p className="text-sm text-[var(--warn)]">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-[var(--ok)]">
            {state.enabled
              ? "On-demand usage enabled. Calls can continue after prepaid is empty."
              : "On-demand usage turned off. Further charges pause at prepaid empty."}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || isBeta}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-60"
        >
          {pending ? "Saving…" : enabled ? "Save — on-demand on" : "Save — on-demand off"}
        </button>
      </form>
    </section>
  );
}
