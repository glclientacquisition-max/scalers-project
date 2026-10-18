import { ReceiptPercentIcon } from "@heroicons/react/24/outline";
import { UsageBar } from "@/components/plan/UsageBar";
import { Empty } from "@/components/ui/Empty";
import { MINUTES_WARN_SHARE, meterTone } from "@/lib/planEntry";

import type { OwnerBillingView } from "@/lib/billingStateModel";

export type BetaPlanRow = { key: string; label: string; included: number; used: number };

const BETA_LABELS: Record<string, string> = { minutes: "Minutes", seats: "Seats", sms: "Message credits" };

/** Minutes, seats, message credits: the order on every plan card. */
export function betaPlanRows(view: Pick<OwnerBillingView, "rows">): BetaPlanRow[] {
  return ["minutes", "seats", "sms"].flatMap((key) => {
    const row = view.rows.find((item) => item.key === key);
    if (!row || row.included <= 0) return [];
    return [{ key, label: BETA_LABELS[key], included: row.included, used: row.used }];
  });
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
export function BetaPlanSummary({
  planName,
  periodEndLabel,
  rows,
}: {
  planName: string | null;
  periodEndLabel: string | null;
  rows: BetaPlanRow[];
}) {
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
                  <span className={`text-body tabular-nums ${tone === "ok" ? "text-ink-2" : "font-medium text-warn"}`}>
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
              </li>
            );
          })}
        </ul>
      ) : null}
      {periodEndLabel ? (
        <p className="mt-4 text-meta text-ink-2">Usage resets after {periodEndLabel}.</p>
      ) : null}
    </section>
  );
}
