"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { useEffect, useMemo, useState } from "react";
import { balanceCents, daysOverdue, displayStatus, ksh, statusTone, type InvoiceRow } from "@/lib/ops/invoicesView";
import { billingHomeTotals, lastMonthCollected, overdueAging, owingBusinesses } from "@/lib/ops/billingHomeView";
import { EmptyState, KpiTile, PageHeader, SplitLayout, SplitPane, StatusPill } from "@/components/ops";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const MONTH = new Intl.DateTimeFormat("en-KE", { month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

/** Billing home (ADMIN_V2): denser month money + who owes, BusinessPane on money. Read-only. */
export function AdminBillingHomeV2({ rows, nowIso }: { rows: InvoiceRow[]; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const totals = useMemo(() => billingHomeTotals(rows, now), [rows, now]);
  const prior = useMemo(() => lastMonthCollected(rows, now), [rows, now]);
  const aging = useMemo(() => overdueAging(rows, now), [rows, now]);
  const agingTotal = aging.to7 + aging.to30 + aging.over30;
  const collectedShare = totals.billedThisMonthCents > 0 ? Math.min(1, totals.collectedThisMonthCents / totals.billedThisMonthCents) : null;
  const asOf = useMemo(() => new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" }).format(now), [now]);
  const owing = useMemo(() => owingBusinesses(rows, now), [rows, now]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pane");
    if (id && owing.some((b) => b.businessId === id)) setSel(id);
  }, [owing]);
  const it = owing.find((b) => b.businessId === sel) ?? null;
  /** The business's settled invoices, newest first, so the pane shows how it usually pays. */
  const paidBefore = useMemo(
    () =>
      it
        ? rows
            .filter((r) => r.businessId === it.businessId && r.paidAt)
            .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""))
            .slice(0, 6)
        : [],
    [rows, it],
  );
  const late = (n: number) => (n ? `${n} d` : "—");

  const list = (
    <div className="flex min-h-0 w-full flex-col pe-ops-4">
      <PageHeader title="Billing" actions={<span className="text-ops-label text-ink-2">{MONTH.format(now)}</span>} />
      <div className="ops-tiles pb-ops-3" data-billing-kpis="">
        <KpiTile label="Billed" period="This month" href="/admin/billing/invoices" value={ksh(totals.billedThisMonthCents)} />
        <KpiTile label="Collected" period="This month" href="/admin/billing/payments" value={ksh(totals.collectedThisMonthCents)} compare={prior ? `vs ${prior.label} ${ksh(prior.cents)}` : null} />
        {totals.outstandingCents === totals.overdueCents ? (
          <KpiTile label={totals.overdueCount ? `Outstanding · ${totals.overdueCount}` : "Outstanding"} period="Now" href="/admin/billing/invoices?view=overdue" value={ksh(totals.outstandingCents)} />
        ) : (
          <>
            <KpiTile label="Outstanding" period="Now" href="/admin/billing/invoices" value={ksh(totals.outstandingCents)} />
            <KpiTile label={`Overdue · ${totals.overdueCount}`} period="Now" href="/admin/billing/invoices?view=overdue" value={ksh(totals.overdueCents)} />
          </>
        )}
      </div>
      <section className="flex flex-col gap-2 pb-ops-3" aria-label="Collected and overdue">
        <h2 className="text-ops-heading text-ink">Collected of billed</h2>
        {collectedShare == null ? (
          <p className="text-ops-body text-ink-2">Nothing billed this month.</p>
        ) : (
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(collectedShare * 100)} percent collected`}>
            <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${collectedShare})` }} />
          </div>
        )}
        <h2 className="text-ops-heading text-ink">Overdue by age</h2>
        {agingTotal === 0 ? (
          <p className="text-ops-body text-ink-2">Nothing overdue.</p>
        ) : (
          <>
            <a href="/admin/billing/invoices?view=overdue" className="flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Overdue by age">
              {([["to7", aging.to7, "var(--status-warn-fg)"], ["to30", aging.to30, "var(--status-danger-fg)"], ["over30", aging.over30, "var(--ink)"]] as const).filter(([, n]) => n > 0).map(([key, n, color]) => (
                <span key={key} style={{ width: `${(n / agingTotal) * 100}%`, background: color }} />
              ))}
            </a>
            <p className="text-ops-label tabular-nums text-ink-2">
              {ksh(aging.to7)} in 0-7 days · {ksh(aging.to30)} in 8-30 days · {ksh(aging.over30)} over 30 days
            </p>
          </>
        )}
      </section>
      <p className="pb-ops-3 text-ops-label text-ink-3">As of {asOf}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-ops-3 pb-ops-2">
        <h2 className="text-ops-heading text-ink">
          Who owes <span className="ops-num font-normal text-ink-2">{owing.length}</span>
        </h2>
        <span className="text-ops-label text-ink-2">Most days late first</span>
      </div>
      {owing.length === 0 ? (
        <EmptyState title="Nobody owes anything." />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {owing.map((b) => (
              <li key={b.businessId}>
                <button
                  type="button"
                  onClick={() => setSel(b.businessId)}
                  className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-ops-2 text-start"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{b.businessName}</span>
                    <span className="tabular-nums text-ink">{ksh(b.balanceCents)}</span>
                  </span>
                  <span className="text-ops-label tabular-nums text-ink-2">
                    {b.openCount} unpaid{b.oldestLateDays ? ` · ${b.oldestLateDays} d late` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-owing-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-end font-normal">Unpaid</th>
                <th className="px-ops-3 text-end font-normal">Late</th>
                <th className="px-ops-3 text-end font-normal">Overdue</th>
                <th className="px-ops-3 text-end font-normal">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {owing.map((b) => (
                <tr
                  key={b.businessId}
                  aria-selected={sel === b.businessId}
                  onClick={() => setSel(b.businessId)}
                  className={["h-ops-row cursor-pointer", sel === b.businessId ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="max-w-[14rem] truncate px-ops-3 text-ink">
                    <button
                      type="button"
                      className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {b.businessName}
                    </button>
                  </td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{b.openCount}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{late(b.oldestLateDays)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{b.overdueCents ? ksh(b.overdueCents) : "—"}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{ksh(b.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-surface-2 text-ops-body font-semibold text-ink">
              <tr className="h-ops-row border-t border-hairline">
                <td className="px-ops-3" colSpan={3}>
                  {owing.length} businesses · void and draft not counted
                </td>
                <td className="px-ops-3 text-end tabular-nums">{ksh(totals.overdueCents)}</td>
                <td className="px-ops-3 text-end tabular-nums">{ksh(totals.outstandingCents)}</td>
              </tr>
            </tfoot>
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
            open={!!it}
            onClose={() => setSel(null)}
            title={it ? it.businessName : ""}
            facts={
              it
                ? [
                    { label: "Balance", value: ksh(it.balanceCents) },
                    { label: "Overdue", value: it.overdueCents ? ksh(it.overdueCents) : "None" },
                    { label: "Unpaid invoices", value: String(it.openCount) },
                    { label: "Oldest late", value: it.oldestLateDays ? `${it.oldestLateDays} days` : "Not late" },
                  ]
                : undefined
            }
            history={
              it
                ? it.invoices
                    .slice()
                    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
                    .map((r) => ({
                      when: day(r.dueAt),
                      what: (
                        <span className="flex items-center justify-between gap-2">
                          <span className="tabular-nums">
                            {r.number} · {ksh(balanceCents(r))}
                            {daysOverdue(r, now) ? ` · ${daysOverdue(r, now)} d late` : ""}
                          </span>
                          <StatusPill tone={statusTone(r, now)}>{displayStatus(r, now)}</StatusPill>
                        </span>
                      ),
                    }))
                    .concat(
                      it.invoices.flatMap((r) =>
                        r.lines.map((l) => ({
                          when: ksh(l.amountCents),
                          what: (
                            <span className="text-ink-2">
                              {r.number} · {l.description}
                            </span>
                          ),
                        })),
                      ),
                    )
                    .concat(
                      paidBefore.map((r) => ({
                        when: day(r.paidAt),
                        what: (
                          <span className="tabular-nums">
                            Paid {r.number} · {ksh(r.paidCents)}
                          </span>
                        ),
                      })),
                    )
                : undefined
            }
            related={
              it
                ? [
                    ...it.invoices.map((r) => ({
                      label: `Invoice ${r.number}`,
                      href: `/admin/billing/invoices?pane=${r.id}`,
                      meta: ksh(balanceCents(r)),
                    })),
                    { label: "All invoices for this business", href: `/admin/billing/invoices?business=${it.businessId}` },
                    { label: "Payments", href: `/admin/billing/payments` },
                    { label: "Business money", href: businessPaneHref(it.businessId, "money") },
                  ]
                : undefined
            }
            footer={
              it ? (
                <span className="text-ops-label text-ink-2">
                  Reminders and recorded payments need a fresh code; they arrive with step-up. Packages catalog is under Billing →
                  Packages (assign stays on the business).
                </span>
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}
