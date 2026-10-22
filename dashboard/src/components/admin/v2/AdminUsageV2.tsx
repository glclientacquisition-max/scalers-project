"use client";

import { useEffect, useMemo, useState } from "react";
import { Headline, SplitLayout, SplitPane, StatusPill, EmptyState } from "@/components/ops";
import {
  RESOLUTION_LABEL,
  buildUsage,
  callsOnDay,
  dayLabel,
  eatTime,
  minLabel,
  paceLine,
  type UsageInput,
} from "@/lib/ops/usageView";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const d = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");
/** Period end is exclusive (midnight EAT); show the last day inside it. */
const dEnd = (iso: string | null) => (iso ? DATE.format(new Date(new Date(iso).getTime() - 1)) : "—");
const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

/** Minutes by day against the package for one business (ADMIN_V2). Read-only. */
export function AdminUsageV2({ data, tenantId, nowIso, currentPeriod }: { data: UsageInput; tenantId: string; nowIso: string; currentPeriod: boolean }) {
  const v = useMemo(() => buildUsage(data, nowIso), [data, nowIso]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const day = new URLSearchParams(window.location.search).get("day");
    if (day && v.days.some((x) => x.date === day)) setSel(day);
  }, [v.days]);
  const maxSec = Math.max(60, ...v.days.map((x) => x.seconds));
  const includedSec = data.includedMinutes * 60;
  const pct = v.share == null ? null : Math.round(v.share * 100);
  const tone = v.share == null ? "neutral" : v.share > 1 ? "danger" : v.share >= 0.8 ? "warn" : "ok";
  const dayCalls = sel ? callsOnDay(data.calls, sel) : [];
  const selDay = v.days.find((x) => x.date === sel) ?? null;
  const rowsDesc = v.days.toReversed();

  const list = (
    <div className="flex min-h-0 flex-col gap-ops-3 pe-ops-4">
      <h1 className="text-ops-title text-ink">Usage · {data.businessName}</h1>
      <Headline
        label={`${data.packageName ?? "No package"} · ${d(data.periodStart)} to ${dEnd(data.periodEnd)}${currentPeriod ? "" : " (past period)"}`}
        value={<>{v.usedMinutes.toLocaleString("en-KE")} min <span className="text-ops-heading font-normal text-ink-2">of {data.includedMinutes.toLocaleString("en-KE")} included</span></>}
        sub={<span className="inline-flex flex-wrap items-center gap-ops-2">{pct != null ? <StatusPill tone={tone}>{pct}% used</StatusPill> : null}<span>{paceLine(v, data.onDemandEnabled)}</span></span>}
        actions={[
          { label: "Invoices", href: `/admin/billing/invoices?business=${tenantId}` },
          { label: "Calls", href: `/admin/quality/${tenantId}` },
        ]}
      >
        {includedSec > 0 ? (
          <div className="h-2 w-full overflow-hidden rounded-sm bg-surface-2" role="img" aria-label={`${pct}% of included minutes used`}>
            <div className="h-full" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: `var(--ops-status-${tone}-fg)` }} />
          </div>
        ) : null}
      </Headline>

      <dl className="grid grid-cols-2 gap-x-ops-4 gap-y-ops-2 text-ops-body md:grid-cols-4" data-usage-facts="">
        {[
          ["On-demand minutes", `${v.onDemandMinutes.toLocaleString("en-KE")} min${data.onDemandEnabled ? "" : " (on-demand off)"}`],
          ["On-demand owed", data.onDemandOwedKes != null ? kes(data.onDemandOwedKes) : currentPeriod ? "Not recorded" : "See the invoice"],
          ["Days left", v.daysLeft != null ? String(v.daysLeft) : "—"],
          ["Busiest day", v.peakDay ? `${dayLabel(v.peakDay.date)} · ${minLabel(v.peakDay.seconds)}` : "—"],
        ].map(([k, val]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-ops-label text-ink-2">{k}</dt>
            <dd className="ops-num text-ink">{val}</dd>
          </div>
        ))}
      </dl>

      {v.days.length === 0 ? (
        <EmptyState title="No calls in this period." />
      ) : (
        <>
          <div className="flex h-28 items-end gap-px border-b border-hairline" role="img" aria-label="Call minutes per day" data-usage-bars="">
            {v.days.map((x) => (
              <button
                key={x.date}
                type="button"
                onClick={() => setSel(x.date)}
                title={`${dayLabel(x.date)}: ${minLabel(x.seconds)}`}
                aria-label={`${dayLabel(x.date)}: ${minLabel(x.seconds)}`}
                className="flex h-full min-w-0 flex-1 items-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span
                  className="block w-full rounded-t-[2px]"
                  style={{
                    height: `${Math.max(2, (x.seconds / maxSec) * 100)}%`,
                    background: x.overIncluded ? "var(--ops-status-warn-fg)" : sel === x.date ? "var(--ops-status-info-fg)" : "var(--ops-status-neutral-fg)",
                    opacity: sel && sel !== x.date ? 0.5 : 1,
                  }}
                />
              </button>
            ))}
          </div>
          <p className="text-ops-label text-ink-2">Bars are call minutes per day (EAT). Amber is after the running total passed the included minutes. The total above is the billing meter, which can differ from call time by a few seconds per call.</p>

          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rowsDesc.map((x) => (
              <li key={x.date}>
                <button type="button" onClick={() => setSel(x.date)} className="flex min-h-ops-touch w-full items-center justify-between gap-2 px-ops-3 py-2 text-start">
                  <span className="flex flex-col">
                    <span className="text-ink">{dayLabel(x.date)}</span>
                    <span className="text-ops-label text-ink-2">{x.calls} calls · total {minLabel(x.runningSeconds)}</span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="tabular-nums text-ink">{minLabel(x.seconds)}</span>
                    {x.crossedIncluded ? <StatusPill tone="warn">Passed package</StatusPill> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-usage-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Day</th>
                <th className="px-ops-3 text-end font-normal">Calls</th>
                <th className="px-ops-3 text-end font-normal">Minutes</th>
                <th className="px-ops-3 text-end font-normal">Running total</th>
                <th className="px-ops-3 text-end font-normal">Of package</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rowsDesc.map((x) => (
                <tr key={x.date} aria-selected={sel === x.date} onClick={() => setSel(x.date)} className={["h-ops-row cursor-pointer", sel === x.date ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}>
                  <td className="px-ops-3 text-ink"><button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{dayLabel(x.date)}</button></td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{x.calls}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{minLabel(x.seconds)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{minLabel(x.runningSeconds)}</td>
                  <td className="px-ops-3 text-end tabular-nums">
                    {includedSec > 0 ? (x.crossedIncluded ? <StatusPill tone="warn">Passed package</StatusPill> : <span className="text-ink-2">{Math.round((x.runningSeconds / includedSec) * 100)}%</span>) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout
        list={list}
        pane={
          <SplitPane
            open={!!selDay}
            onClose={() => setSel(null)}
            title={selDay ? `${dayLabel(selDay.date)} · ${data.businessName}` : ""}
            facts={selDay ? [
              { label: "Calls", value: String(selDay.calls) },
              { label: "Minutes", value: minLabel(selDay.seconds) },
              { label: "Running total", value: minLabel(selDay.runningSeconds) },
              { label: "Included", value: `${data.includedMinutes} min` },
              { label: "Package", value: selDay.crossedIncluded ? "Passed the included minutes this day" : selDay.overIncluded ? "Already over" : "Within" },
            ] : undefined}
            history={selDay ? dayCalls.map((c) => ({
              when: `${eatTime(c.createdAt)} EAT`,
              what: <a href={`/admin/quality/call/${encodeURIComponent(c.id)}`} className="text-ink underline-offset-2 hover:underline">{minLabel(c.durationSeconds)} · {RESOLUTION_LABEL[c.resolution ?? "unknown"] ?? "Not recorded"}</a>,
            })) : undefined}
            related={selDay ? [
              { label: "Invoices for this business", href: `/admin/billing/invoices?business=${tenantId}` },
              { label: "Billing history", href: `/admin/billing/${tenantId}` },
              { label: "Business", href: `/admin/businesses/${tenantId}` },
            ] : undefined}
          />
        }
      />
    </div>
  );
}
