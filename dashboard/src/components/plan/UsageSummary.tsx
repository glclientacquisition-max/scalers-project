import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsageBar, toneText } from "@/components/plan/UsageBar";
import { MINUTES_WARN_SHARE, meterTone, type MeterTone, type PlanEntry } from "@/lib/planEntry";

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

const TEAM_HREF = "/settings?tab=train&panel=team";

function AllowanceRow({ row, footer }: { row: UsageListRow; footer?: (tone: MeterTone) => ReactNode }) {
  const tone = meterTone(row.used, row.included, null);
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-body font-medium text-ink">{row.label}</span>
        <span className={`shrink-0 text-title tabular-nums ${toneText(tone)}`}>
          {count(row.left)}
          <span className="text-meta font-normal text-ink-2"> left</span>
        </span>
      </div>
      <p className="mt-0.5 text-meta tabular-nums text-ink-2">
        {count(row.used)} used of {count(row.included)}
      </p>
      <UsageBar used={row.used} included={row.included} tone={tone} label={`${row.label} used`} thin className="mt-2" />
      {footer ? footer(tone) : null}
    </li>
  );
}

export function UsageSummary({
  minutesLeft,
  minutesIncluded,
  minutesUsed,
  periodEndLabel,
  beta,
  planLine,
  entry,
  seats,
  credits,
  children,
}: {
  minutesLeft: number;
  minutesIncluded: number;
  minutesUsed: number;
  periodEndLabel: string | null;
  beta: boolean;
  planLine: string | null;
  /** Change plan or Choose a plan. Null on beta and without billing.manage. */
  entry: PlanEntry | null;
  seats: UsageListRow | null;
  /** The plan's one message-credit allowance. Null hides Messages. */
  credits: UsageListRow | null;
  /** Extra usage and activity, under the minutes card. */
  children?: ReactNode;
}) {
  const minuteMax = Math.max(0, minutesIncluded);
  const tone = meterTone(minutesUsed, minuteMax, MINUTES_WARN_SHARE);
  const meta = beta ? "Free during beta. Nothing is charged." : planLine;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Usage"
        meta={meta || undefined}
        action={
          entry ? (
            <ButtonLink href={entry.href} variant={entry.variant} size="sm">
              {entry.label}
            </ButtonLink>
          ) : null
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <section aria-label="Minutes" className="min-w-0 rounded-2xl border border-hairline bg-surface p-4 lg:col-span-7">
          <p className={`font-display text-display tabular-nums ${toneText(tone)}`}>{count(minutesLeft)}</p>
          <p className="text-body text-ink-2">
            Minutes left{periodEndLabel ? ` until ${periodEndLabel}` : ""}
          </p>
          {minuteMax > 0 ? (
            <>
              <p className="mt-4 text-meta tabular-nums text-ink-2">
                {count(minutesUsed)} used of {count(minutesIncluded)}
              </p>
              <UsageBar used={minutesUsed} included={minuteMax} tone={tone} label="Minutes used" className="mt-2" />
              {tone !== "ok" ? (
                <p role="status" className="mt-3 text-meta font-medium text-warn">
                  {tone === "full" ? "Out of minutes" : "Running low on minutes"}
                </p>
              ) : null}
              {tone !== "ok" && entry ? (
                <ButtonLink href={entry.href} variant="tonal" block className="mt-3">
                  {entry.label}
                </ButtonLink>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-body text-ink-2">No package minutes</p>
          )}
        </section>

        {seats || credits ? (
          <div className="min-w-0 space-y-6 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
            {seats ? (
              <section aria-labelledby="usage-team">
                <h2 id="usage-team" className="mb-2 px-1 text-meta font-medium text-ink-2">
                  Team
                </h2>
                <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                  <AllowanceRow
                    row={seats}
                    footer={(seatTone) =>
                      seatTone === "full" ? (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p role="status" className="text-meta font-medium text-warn">
                            All seats are in use
                          </p>
                          {entry ? (
                            <ButtonLink href={entry.href} variant="tonal" size="sm">
                              {entry.label}
                            </ButtonLink>
                          ) : (
                            <Link
                              href={TEAM_HREF}
                              className="inline-flex min-h-11 items-center text-meta font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            >
                              Team
                            </Link>
                          )}
                        </div>
                      ) : null
                    }
                  />
                </ul>
              </section>
            ) : null}
            {credits ? (
              <section aria-labelledby="usage-messages">
                <h2 id="usage-messages" className="mb-2 px-1 text-meta font-medium text-ink-2">
                  Messages
                </h2>
                <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                  <AllowanceRow
                    row={credits}
                    footer={(rowTone) =>
                      rowTone === "full" ? (
                        <p role="status" className="mt-2 text-meta font-medium text-warn">
                          No message credits left
                        </p>
                      ) : null
                    }
                  />
                </ul>
                <p className="mt-2 px-1 text-meta text-ink-2">
                  Texts, WhatsApp and email to you, your team and callers all use message credits.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        {children ? <div className="min-w-0 space-y-6 lg:col-span-7">{children}</div> : null}
      </div>
    </div>
  );
}
