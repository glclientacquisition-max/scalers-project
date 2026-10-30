"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { useEffect, useState } from "react";
import { EmptyState, Headline, SplitLayout, SplitPane, StatusPill } from "@/components/ops";
import { BREAKDOWN_MIN, FLOOR, INSIGHT_RANGES, shown, shownShare, type GroupCount, type InsightsData } from "@/lib/ops/insightsView";
import "@/styles/ops.css";

const WEEK = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

function GroupTable({ groups, total, label }: { groups: GroupCount[]; total: number; label: string }) {
  return (
    <table className="w-full text-ops-body" aria-label={label}>
      <thead className="text-ops-label text-ink-2">
        <tr className="h-ops-row border-b border-hairline">
          <th className="px-ops-3 text-start font-normal">Reason</th>
          <th className="px-ops-3 text-end font-normal">Calls</th>
          <th className="px-ops-3 text-end font-normal">Share</th>
          <th className="px-ops-3 text-end font-normal">Missed</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline bg-surface">
        {groups.map((g) => (
          <tr key={g.id} className="h-ops-row">
            <td className="px-ops-3 text-ink">{g.label}</td>
            <td className="px-ops-3 text-end tabular-nums text-ink">{shown(g.calls)}</td>
            <td className="px-ops-3 text-end tabular-nums text-ink-2">{shownShare(g.calls, total)}</td>
            <td className="px-ops-3 text-end tabular-nums text-ink-2">{shown(g.missed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Call insights across all businesses (ADMIN_V2). Counts only; under 10 shows "<10". Read-only. */
export function AdminInsightsV2({ data }: { data: InsightsData }) {
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get("business");
    if (b && data.businesses.some((x) => x.tenantId === b)) setSel(b);
  }, [data.businesses]);
  const selB = data.businesses.find((b) => b.tenantId === sel) ?? null;
  const det = sel ? data.detail[sel] : undefined;
  const missedTone = data.demand >= FLOOR && data.missed / data.demand >= 0.3 ? "warn" : "neutral";

  const list = (
    <div className="flex min-h-0 flex-col gap-ops-3 pe-ops-4">
      <div className="flex flex-wrap items-center justify-between gap-ops-2">
        <h1 className="text-ops-title text-ink">Call insights</h1>
        <nav aria-label="Range" className="flex gap-px rounded-sm border border-hairline p-px">
          {INSIGHT_RANGES.map((d) => (
            <a key={d} href={`?days=${d}`} aria-current={d === data.days ? "page" : undefined}
              className={["inline-flex h-ops-touch items-center rounded-sm px-ops-3 text-ops-body md:h-7", d === data.days ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"].join(" ")}>
              {d} days
            </a>
          ))}
        </nav>
      </div>
      <Headline
        label={`Price and buying questions missed · last ${data.days} days`}
        value={<>{shown(data.missed)} <span className="text-ops-heading font-normal text-ink-2">of {shown(data.demand)}</span></>}
        sub={<span className="inline-flex flex-wrap items-center gap-ops-2"><StatusPill tone={missedTone}>{shownShare(data.missed, data.demand)} missed</StatusPill><span>{shown(data.calls)} answered calls reviewed. Missed means unanswered, lost, or a callback promised.</span></span>}
        actions={[
          { label: "Needs attention", href: "/admin" },
          { label: "Quality", href: "/admin/quality" },
        ]}
      />

      {data.calls === 0 ? (
        <EmptyState
          title={`No reviewed calls in the last ${data.days} days.`}
          action={data.days < 90 ? (
            <a href={`?days=${data.days === 7 ? 30 : 90}`} className="inline-flex min-h-11 items-center text-ops-body font-medium text-accent">Wider range</a>
          ) : undefined}
        />
      ) : (
        <>
          <GroupTable groups={data.groups} total={data.calls} label="All businesses by reason" />
          <h2 className="text-ops-heading text-ink">By business</h2>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {data.businesses.map((b) => (
              <li key={b.tenantId}>
                <button type="button" onClick={() => setSel(b.tenantId)} className="flex min-h-ops-touch w-full items-center justify-between gap-2 px-ops-3 py-2 text-start">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ink">{b.name}</span>
                    <span className="text-ops-label text-ink-2">{b.breakdown ? b.topGroup ?? "No single top reason" : `Under ${BREAKDOWN_MIN} calls`}</span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="tabular-nums text-ink">{shown(b.calls)} calls</span>
                    <span className="text-ops-label tabular-nums text-ink-2">{b.breakdown ? `${shown(b.missed)} missed` : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-insights-table="">
            <thead className="text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-end font-normal">Calls</th>
                <th className="px-ops-3 text-start font-normal">Top reason</th>
                <th className="px-ops-3 text-end font-normal">Price or buying</th>
                <th className="px-ops-3 text-end font-normal">Missed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {data.businesses.map((b) => (
                <tr key={b.tenantId} aria-selected={sel === b.tenantId} onClick={() => setSel(b.tenantId)} className={["h-ops-row cursor-pointer", sel === b.tenantId ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}>
                  <td className="px-ops-3 text-ink"><button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{b.name}</button></td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{shown(b.calls)}</td>
                  <td className="px-ops-3 text-ink-2">{b.breakdown ? b.topGroup ?? "—" : `Under ${BREAKDOWN_MIN} calls`}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{b.breakdown ? shown(b.demand) : "—"}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{b.breakdown ? <>{shown(b.missed)} <span className="text-ops-label text-ink-2">· {shownShare(b.missed, b.demand)}</span></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-ops-label text-ink-2">Counts only, from reviewed calls that connected. Any figure under {FLOOR} shows as &lt;{FLOOR}. Businesses with under {BREAKDOWN_MIN} calls in the range get no breakdown. No caller details are shown here.</p>
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
            open={!!selB}
            onClose={() => setSel(null)}
            title={selB ? `${selB.name} · ${data.days} days` : ""}
            facts={selB ? [
              { label: "Calls", value: shown(selB.calls) },
              { label: "Price or buying", value: selB.breakdown ? shown(selB.demand) : "—" },
              { label: "Missed", value: selB.breakdown ? `${shown(selB.missed)} · ${shownShare(selB.missed, selB.demand)}` : "—" },
              { label: "Top reason", value: selB.breakdown ? selB.topGroup ?? "—" : `Under ${BREAKDOWN_MIN} calls, no breakdown` },
              ...(det ? det.groups.filter((g) => g.calls > 0).map((g) => ({ label: g.label, value: `${shown(g.calls)} · ${shown(g.missed)} missed` })) : []),
              ...(det ? det.outcomes.filter((o) => o.calls > 0).map((o) => ({ label: `Ended: ${o.label.toLowerCase()}`, value: shown(o.calls) })) : []),
            ] : undefined}
            history={det && det.weeks.length > 1 ? det.weeks.map((w) => ({
              when: `Week to ${WEEK.format(new Date(w.ending))}`,
              what: `${shown(w.calls)} calls · ${shown(w.missed)} price or buying missed`,
            })) : undefined}
            related={selB ? [
              { label: "Calls and quality", href: businessPaneHref(selB.tenantId, "calls") },
              { label: "Usage this period", href: `/admin/businesses/${selB.tenantId}/usage` },
            ] : undefined}
          />
        }
      />
    </div>
  );
}
