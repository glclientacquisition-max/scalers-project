import { ReceiptPercentIcon } from "@heroicons/react/24/outline";
import { UsageBar } from "@/components/plan/UsageBar";
import { Empty } from "@/components/ui/Empty";
import { MINUTES_WARN_SHARE, meterTone } from "@/lib/planEntry";

import type { OwnerBillingView } from "@/lib/billingStateModel";
import type { MessageCreditsUsage } from "@/lib/messageCredits";
import { planOverageLines, resolvePlanOverageMode, type PlanOverageMode } from "@/lib/planOverageCopy";

export type BetaPlanRow = { key: string; label: string; included: number; used: number };

const BETA_LABELS: Record<string, string> = { minutes: "Minutes", seats: "Seats" };

/** Minutes, seats, message credits: the order on every plan card. Credits hide without a plan allowance. */
export function betaPlanRows(view: Pick<OwnerBillingView, "rows">, credits: MessageCreditsUsage | null): BetaPlanRow[] {
  const rows = ["minutes", "seats"].flatMap((key) => {
    const row = view.rows.find((item) => item.key === key);
    if (!row || row.included <= 0) return [];
    return [{ key, label: BETA_LABELS[key], included: row.included, used: row.used }];
  });
  if (credits) rows.push({ key: "credits", label: "Message credits", included: credits.included, used: credits.used });
  return rows;
}

export function BetaInvoicesEmpty() {
  return (
    <Empty
      icon={<ReceiptPercentIcon />}
      title="No invoices during beta"
      line="Invoices show here once beta ends."
      className="mt-4 rounded-2xl border border-hairline bg-surface"
    />
  );
}

function count(n: number): string {
  return n.toLocaleString("en-KE");
}

/** Beta Plan page: the plan, what it includes, and what is used. No prices. */
function MinutesOverageNote({
  used,
  included,
  mode,
  periodEndLabel,
}: {
  used: number;
  included: number;
  mode: PlanOverageMode;
  periodEndLabel: string | null;
}) {
  const over = planOverageLines(used, included, mode, periodEndLabel);
  if (!over) return null;
  return (
    <div className="mt-2 space-y-0.5" role="status" data-plan-overage="">
      <p className={mode === "on_demand" ? "text-body font-medium tabular-nums text-warn" : "text-body font-medium tabular-nums text-ink"}>
        {over.headline}
      </p>
      <p className="text-meta text-ink-2">{over.detail}</p>
    </div>
  );
}

export function BetaPlanSummary({
  planName,
  periodEndLabel,
  resetLabel = null,
  rows,
  freeBeta = true,
  onDemandEnabled = null,
  onDemandLocked = false,
}: {
  planName: string | null;
  periodEndLabel: string | null;
  resetLabel?: string | null;
  rows: BetaPlanRow[];
  freeBeta?: boolean;
  onDemandEnabled?: boolean | null;
  onDemandLocked?: boolean;
}) {
  const overageMode = resolvePlanOverageMode({ freeBeta, onDemandLocked, onDemandEnabled });
  return (
    <section aria-label="Your plan" className="mt-4 rounded-2xl border border-hairline bg-surface p-4">
      <h2 className="text-title text-ink">{planName || "Your plan"}</h2>
      <p className="mt-0.5 text-body text-ink-2">Free during beta</p>
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-4">
          {rows.map((row) => {
            const tone = meterTone(row.used, row.included, row.key === "minutes" ? MINUTES_WARN_SHARE : null);
            return (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body text-ink">{row.label}</span>
                  <span className={`text-body tabular-nums ${tone !== "ok" && overageMode === "on_demand" ? "font-medium text-warn" : "text-ink-2"}`}>
                    {count(row.used)} of {count(row.included)} used
                  </span>
                </div>
                <UsageBar
                  used={row.used}
                  included={row.included}
                  tone={tone}
                  label={`${row.label} used`}
                  thin
                  className="mt-2"
                />
                {row.key === "minutes" ? (
                  <MinutesOverageNote
                    used={row.used}
                    included={row.included}
                    mode={overageMode}
                    periodEndLabel={periodEndLabel}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {resetLabel ? <p className="mt-4 text-meta text-ink-2">Resets {resetLabel}.</p> : null}
      {freeBeta ? <p className="mt-4 text-body text-ink">Invoices start when beta ends.</p> : null}
    </section>
  );
}
