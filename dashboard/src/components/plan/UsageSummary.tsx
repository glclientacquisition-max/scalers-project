import Link from "next/link";
import { ListRow } from "@/components/ui/ListRow";
import { PageHeader } from "@/components/ui/PageHeader";

function count(n: number): string {
  return n.toLocaleString("en-KE");
}

export type UsageListRow = {
  key: string;
  label: string;
  included: number;
  used: number;
  left: number;
};

export function UsageSummary({
  minutesLeft,
  minutesIncluded,
  minutesUsed,
  periodEndLabel,
  beta,
  planLine,
  rows,
  showChangePlan,
}: {
  minutesLeft: number;
  minutesIncluded: number;
  minutesUsed: number;
  periodEndLabel: string | null;
  beta: boolean;
  planLine: string | null;
  rows: UsageListRow[];
  showChangePlan: boolean;
}) {
  const minuteMax = Math.max(0, minutesIncluded);
  const minuteLeftPct = minuteMax > 0 ? Math.min(100, Math.round((minutesLeft / minuteMax) * 100)) : 0;
  const meta = beta ? "Free during beta. Nothing is charged." : planLine;

  return (
    <div className="w-full min-w-0 max-w-2xl">
      <PageHeader
        title="Usage"
        meta={meta || undefined}
        action={
          showChangePlan ? (
            <Link
              href="/settings/plan"
              className="text-meta text-ink-2 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Change plan
            </Link>
          ) : null
        }
      />

      <section className="mt-6">
        <p className="font-display text-display tabular-nums text-ink">{count(minutesLeft)}</p>
        <p className="text-body text-ink-2">
          Minutes left{periodEndLabel ? ` until ${periodEndLabel}` : ""}
        </p>
        {minuteMax > 0 ? (
          <>
            <p className="mt-1 text-meta tabular-nums text-ink-2">
              {count(minutesUsed)} used of {count(minutesIncluded)}
            </p>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
              role="meter"
              aria-label="Minutes left"
              aria-valuemin={0}
              aria-valuemax={minuteMax}
              aria-valuenow={minutesLeft}
            >
              <div className="h-full bg-accent" style={{ width: `${minuteLeftPct}%` }} />
            </div>
          </>
        ) : (
          <p className="mt-2 text-body text-ink-2">No package minutes</p>
        )}
      </section>

      {rows.length > 0 ? (
        <ul className="mt-6 overflow-hidden rounded-2xl border border-hairline">
          {rows.map((row) => (
            <ListRow
              key={row.key}
              title={row.label}
              preview={`${count(row.used)} used of ${count(row.included)}`}
              when={`${count(row.left)} left`}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
