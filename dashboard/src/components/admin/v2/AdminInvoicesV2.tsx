"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INVOICE_VIEWS,
  balanceCents,
  daysOverdue,
  defaultInvoiceView,
  displayStatus,
  invoiceCounts,
  invoiceTotals,
  invoicesCsv,
  inInvoiceView,
  ksh,
  matchesInvoice,
  statusTone,
  type InvoiceRow,
  type InvoiceView,
} from "@/lib/ops/invoicesView";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState } from "@/components/ops";
import { ButtonLink } from "@/components/ui/Button";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

/** Invoices as a table plus pane (ADMIN_V2). Read-only: resend, credit and void wait for step-up codes. */
export function AdminInvoicesV2({
  rows: all,
  truncated = false,
  businessName = null,
  nowIso,
}: {
  rows: InvoiceRow[];
  truncated?: boolean;
  /** Set when the list is filtered to one business. */
  businessName?: string | null;
  /** Server time, so Overdue matches on both sides. */
  nowIso: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<InvoiceView>(() => defaultInvoiceView(all, now));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = INVOICE_VIEWS.find((x) => x.id === p.get("view"));
    if (v) setView(v.id);
    const hit = all.find((x) => x.id === p.get("pane"));
    if (hit) {
      setSel(hit.id);
      if (!v) setView(INVOICE_VIEWS.find((x) => x.id !== "all" && inInvoiceView(hit, x.id, now))?.id ?? "all");
    }
  }, [all, now]);
  const counts = useMemo(() => invoiceCounts(all, now), [all, now]);
  const rows = useMemo(
    () => all.filter((r) => (query.trim() ? true : inInvoiceView(r, view, now)) && matchesInvoice(r, query)),
    [all, view, query, now],
  );
  const totals = useMemo(() => invoiceTotals(rows), [rows]);
  const it = all.find((x) => x.id === sel) ?? null;
  const isOverdueRow = (r: InvoiceRow) => daysOverdue(r, now) > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = rows.findIndex((r) => r.id === sel);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))];
      if (next) setSel(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel]);

  const exportCsv = () => {
    const blob = new Blob([invoicesCsv(rows, now)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoices-${view}-${nowIso.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader title={businessName ? `Invoices · ${businessName}` : "Invoices"} count={all.length} />
      <div className="flex flex-wrap items-center gap-2 pb-ops-3">
        <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
          {INVOICE_VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id && !query.trim()}
              onClick={() => { setView(v.id); setQuery(""); }}
              className={[
                "inline-flex h-ops-touch items-center gap-1.5 rounded-sm px-ops-3 text-ops-body md:h-8",
                view === v.id && !query.trim() ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
              ].join(" ")}
            >
              {v.label}
              <span className="tabular-nums text-ink-2">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Invoice number or business"
            aria-label="Search invoices"
            className="ops-field min-w-0 flex-1 text-ink md:max-w-80"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="ms-auto inline-flex h-ops-touch shrink-0 items-center rounded-sm border border-hairline px-ops-3 text-ops-body text-ink hover:bg-surface-2 disabled:opacity-50 md:h-8"
          >
            Export CSV
          </button>
        </div>
      </div>
      {truncated ? <p className="pb-ops-3 text-ops-label text-ink-2">Newest 500 shown. Filter by business to see older invoices.</p> : null}
      {rows.length === 0 ? (
        <EmptyState title={query.trim() ? "No invoice matches." : "Nothing in this view."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSel(r.id)} className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.businessName}</span>
                    <span className="tabular-nums text-ink">{ksh(balanceCents(r))}</span>
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 text-ops-label text-ink-2">
                    <span className="tabular-nums">{r.number}{daysOverdue(r, now) ? ` · ${daysOverdue(r, now)} d late` : ""}</span>
                    <StatusPill tone={statusTone(r, now)}>{displayStatus(r, now)}</StatusPill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-invoices-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Number</th>
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="hidden px-ops-3 text-end font-normal 2xl:table-cell">Due</th>
                <th className="px-ops-3 text-end font-normal">Late</th>
                <th className="hidden px-ops-3 text-end font-normal 2xl:table-cell">Total</th>
                <th className="px-ops-3 text-end font-normal">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  aria-selected={sel === r.id}
                  onClick={() => setSel(r.id)}
                  className={["h-ops-row cursor-pointer", sel === r.id ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="px-ops-3 tabular-nums text-ink">
                    <button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{r.number}</button>
                  </td>
                  <td className="max-w-[11rem] truncate px-ops-3 text-ink-2">{r.businessName}</td>
                  <td className="px-ops-3"><StatusPill tone={statusTone(r, now)}>{displayStatus(r, now)}</StatusPill></td>
                  <td className="hidden px-ops-3 text-end tabular-nums text-ink-2 2xl:table-cell">{day(r.dueAt)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{daysOverdue(r, now) ? `${daysOverdue(r, now)} d` : "—"}</td>
                  <td className="hidden px-ops-3 text-end tabular-nums text-ink-2 2xl:table-cell">{ksh(r.totalCents)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{ksh(balanceCents(r))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-surface-2 text-ops-body font-semibold text-ink" data-totals="">
              <tr className="h-ops-row border-t border-hairline">
                <td className="px-ops-3" colSpan={4}>{rows.length} in view · void and draft not counted</td>
                <td className="hidden 2xl:table-cell" />
                <td className="hidden px-ops-3 text-end tabular-nums 2xl:table-cell">{ksh(totals.total)}</td>
                <td className="px-ops-3 text-end tabular-nums">{ksh(totals.balance)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="flex justify-between bg-surface-2 px-ops-3 py-2 text-ops-label font-semibold text-ink md:hidden" data-totals-phone="">
            <span>{rows.length} in view</span>
            <span className="tabular-nums">Balance {ksh(totals.balance)}</span>
          </p>
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
            title={it ? `${it.number} · ${it.businessName}` : ""}
            facts={it ? [
              { label: "Number", value: it.status === "draft" ? "None yet" : it.number },
              { label: "Business", value: it.businessName },
              { label: "Issued", value: day(it.issuedAt) },
              { label: "Status", value: <StatusPill tone={statusTone(it, now)}>{displayStatus(it, now)}</StatusPill> },
              { label: "Lines", value: String(it.lines.length) },
              { label: "Total", value: ksh(it.totalCents) },
              { label: "Paid", value: ksh(it.paidCents) },
              { label: "Balance", value: ksh(balanceCents(it)) },
              { label: "Paid on", value: it.paidAt ? day(it.paidAt) : "Not paid" },
              { label: "Due", value: `${day(it.dueAt)}${daysOverdue(it, now) ? ` · ${daysOverdue(it, now)} days late` : ""}` },
              ...(it.periodStart ? [{ label: "Period", value: `${day(it.periodStart)} to ${day(it.periodEnd)}` }] : []),
            ] : undefined}
            history={it ? [
              ...it.lines.map((l) => ({ when: ksh(l.amountCents), what: l.description })),
              ...(it.paidAt ? [{ when: day(it.paidAt), what: `Paid ${ksh(it.paidCents)}` }] : []),
              ...(isOverdueRow(it) ? [{ when: day(it.dueAt), what: `Due, unpaid ${ksh(balanceCents(it))}` }] : it.dueAt && !it.paidAt ? [{ when: day(it.dueAt), what: "Due" }] : []),
              ...(it.issuedAt ? [{ when: day(it.issuedAt), what: "Issued" }] : []),
              { when: day(it.createdAt), what: "Created" },
            ] : undefined}
            related={it ? [
              ...(it.status !== "draft" ? [{ label: "Download PDF", href: `/api/admin/billing/invoices/${it.id}/pdf` }] : []),
              ...(it.periodStart && it.periodEnd ? [{ label: "Usage for this period", href: `/admin/businesses/${it.businessId}/usage?from=${encodeURIComponent(it.periodStart)}&to=${encodeURIComponent(it.periodEnd)}` }] : []),
              { label: "Billing history", href: `/admin/billing/${it.businessId}` },
              { label: "All invoices for this business", href: `/admin/billing/invoices?business=${it.businessId}` },
              { label: "Business", href: `/admin/businesses/${it.businessId}` },
            ] : undefined}
            footer={it ? (
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-ops-label text-ink-2">Resend, credit note and void need a fresh code; they arrive with step-up.</span>
                <ButtonLink href={`/admin/billing/invoices/${it.id}`} variant="primary" size="md">Open invoice</ButtonLink>
              </div>
            ) : undefined}
          />
        }
      />
    </div>
  );
}
