"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SOFT_SPEND_LIMIT_PRESETS_KES,
  softSpendLimitMessage,
  type SoftSpendLimitStatus,
} from "@/lib/wallet";
import {
  saveSoftSpendLimit,
  type SoftSpendLimitState,
} from "@/app/(desk)/wallet/actions";

const initial: SoftSpendLimitState = {};

export function SoftSpendLimitPanel({
  tenantId,
  enabled: initialEnabled,
  limitKes: initialLimitKes,
  status,
  isBeta,
}: {
  tenantId: string;
  enabled: boolean;
  limitKes: number | null;
  status: SoftSpendLimitStatus;
  isBeta: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSoftSpendLimit, initial);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [limitKes, setLimitKes] = useState(
    String(initialLimitKes && initialLimitKes > 0 ? initialLimitKes : 5000)
  );

  useEffect(() => {
    setEnabled(initialEnabled);
    setLimitKes(String(initialLimitKes && initialLimitKes > 0 ? initialLimitKes : 5000));
  }, [initialEnabled, initialLimitKes]);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [state.ok, router]);

  const pct = Math.min(100, Math.round(status.percent));
  const warn = status.thresholdReached >= 80;
  const message = softSpendLimitMessage(status);

  return (
    <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Soft spend limit</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)] max-w-xl leading-relaxed">
            Optional monthly budget you set yourself. Soft means we warn you at 50%, 80%, and
            100% — calls are never blocked by this limit.
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg-deep)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)]">
          {enabled ? "On" : "Off · opt in"}
        </span>
      </div>

      {status.enabled ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <p className="font-medium text-[var(--ink)]">
              KES {status.spentKes.toLocaleString("en-KE")}
              <span className="font-normal text-[var(--ink-soft)]">
                {" "}
                of {status.limitKes.toLocaleString("en-KE")} this month
              </span>
            </p>
            <p className={warn ? "text-[var(--warn)]" : "text-[var(--ink-soft)]"}>{pct}%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-deep)]">
            <div
              className={`h-full rounded-full transition-all ${
                status.thresholdReached >= 100
                  ? "bg-[var(--warn)]"
                  : status.thresholdReached >= 80
                    ? "bg-[var(--warn)]/80"
                    : "bg-[var(--accent)]"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {message ? (
            <p className={`mt-2 text-sm ${warn ? "text-[var(--warn)]" : "text-[var(--ink-soft)]"}`}>
              {message}
            </p>
          ) : null}
          {isBeta ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Free beta: progress uses illustrative rate-card cost (not charged).
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <span className="font-medium text-[var(--ink)]">Turn on soft spend limit</span>
            <span className="block text-[var(--ink-soft)]">
              Opt in only when you want a monthly budget. Leave off for no limit.
            </span>
          </span>
        </label>

        {enabled ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-[var(--ink)]">Monthly limit (KES)</p>
            <div className="flex flex-wrap gap-2">
              {SOFT_SPEND_LIMIT_PRESETS_KES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setLimitKes(String(preset))}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    Number(limitKes) === preset
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-deep)]"
                      : "border-[var(--line)] text-[var(--ink)]"
                  }`}
                >
                  {preset.toLocaleString("en-KE")}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              Custom amount
              <input
                name="limit_kes"
                value={limitKes}
                onChange={(e) => setLimitKes(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full max-w-xs rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                placeholder="5000"
              />
            </label>
            <p className="text-xs text-[var(--ink-soft)]">Minimum KES 500. Soft only — no call blocking.</p>
          </div>
        ) : (
          <input type="hidden" name="limit_kes" value="" />
        )}

        {state.error ? <p className="text-sm text-[var(--warn)]">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-[var(--ok)]">
            {state.enabled
              ? `Soft limit saved: KES ${Number(state.limitKes || 0).toLocaleString("en-KE")}/mo.`
              : "Soft spend limit turned off."}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-60"
        >
          {pending ? "Saving…" : enabled ? "Save soft limit" : "Turn off soft limit"}
        </button>
      </form>
    </section>
  );
}
