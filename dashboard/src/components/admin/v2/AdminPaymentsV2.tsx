"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { useEffect, useMemo, useState } from "react";
import {
  PAYMENT_ACTION_WHY,
  PAYMENT_VIEWS,
  defaultPaymentView,
  displayStatus,
  inPaymentView,
  ksh,
  matchesPayment,
  paymentCounts,
  paymentTotals,
  statusTone,
  type PaymentRow,
  type PaymentView,
} from "@/lib/ops/paymentsView";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState, UnlockCta } from "@/components/ops";
import { Button, ButtonLink } from "@/components/ui/Button";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

/**
 * Payments (ADMIN_V2): list + pane. Collect / void / record stay honest-disabled until Unlock wires them.
 * Gateway switches live under Settings — this screen is the money list.
 * UnlockCta matches #915 (observe); do not fork UnlockCta here.
 */
export function AdminPaymentsV2({
  rows: all,
  truncated = false,
  nowIso,
}: {
  rows: PaymentRow[];
  truncated?: boolean;
  nowIso: string;
}) {
  const [view, setView] = useState<PaymentView>(() => defaultPaymentView(all));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = PAYMENT_VIEWS.find((x) => x.id === p.get("view"));
    if (v) setView(v.id);
    const hit = all.find((x) => x.id === p.get("pane"));
    if (hit) {
      setSel(hit.id);
      if (!v) setView(PAYMENT_VIEWS.find((x) => x.id !== "all" && inPaymentView(hit, x.id))?.id ?? "all");
    }
  }, [all]);

  const counts = useMemo(() => paymentCounts(all), [all]);
  const rows = useMemo(
    () => all.filter((r) => (query.trim() ? true : inPaymentView(r, view)) && matchesPayment(r, query)),
    [all, view, query],
  );
  const totals = useMemo(() => paymentTotals(rows), [rows]);
  const it = all.find((x) => x.id === sel) ?? null;

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

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader
        title="Payments"
        count={all.length}
        actions={
          <UnlockCta
            site="payments"
            action="payments:money"
            what="collect, void or record a payment"
            observedHint="Collect, void and record stay disabled until Unlock enforce (#876 Q9). Observe only logged the gate."
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2 pb-ops-3">
        <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
          {PAYMENT_VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id && !query.trim()}
              onClick={() => {
                setView(v.id);
                setQuery("");
              }}
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
            placeholder="Business, invoice or reference"
            aria-label="Search payments"
            className="ops-field min-w-0 flex-1 text-ink md:max-w-80"
          />
        </div>
      </div>
      {truncated ? (
        <p className="pb-ops-3 text-ops-label text-ink-2">Newest 500 shown. Filter by business to see older payments.</p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={query.trim() ? "No payment matches." : "Nothing in this view."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSel(r.id)}
                  className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-2 text-start"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.businessName}</span>
                    <span className="tabular-nums text-ink">{ksh(r.amountCents)}</span>
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 text-ops-label text-ink-2">
                    <span className="tabular-nums">
                      {r.invoiceNumber || "No invoice"} · {day(r.paidAt || r.createdAt)}
                    </span>
                    <StatusPill tone={statusTone(r)}>{displayStatus(r)}</StatusPill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-payments-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="hidden px-ops-3 text-start font-normal xl:table-cell">Invoice</th>
                <th className="hidden px-ops-3 text-end font-normal 2xl:table-cell">When</th>
                <th className="px-ops-3 text-end font-normal">Amount</th>
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
                  <td className="max-w-[14rem] truncate px-ops-3 text-ink">
                    <button
                      type="button"
                      className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {r.businessName}
                    </button>
                  </td>
                  <td className="px-ops-3">
                    <StatusPill tone={statusTone(r)}>{displayStatus(r)}</StatusPill>
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-ops-3 tabular-nums text-ink-2 xl:table-cell">
                    {r.invoiceNumber || "—"}
                  </td>
                  <td className="hidden px-ops-3 text-end tabular-nums text-ink-2 2xl:table-cell">
                    {day(r.paidAt || r.createdAt)}
                  </td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{ksh(r.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-surface-2 text-ops-body font-semibold text-ink" data-totals="">
              <tr className="h-ops-row border-t border-hairline">
                <td className="px-ops-3" colSpan={3}>
                  {totals.count} in view
                </td>
                <td className="hidden 2xl:table-cell" />
                <td className="px-ops-3 text-end tabular-nums">{ksh(totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
          <p
            className="flex justify-between bg-surface-2 px-ops-3 py-2 text-ops-label font-semibold text-ink md:hidden"
            data-totals-phone=""
          >
            <span>{totals.count} in view</span>
            <span className="tabular-nums">{ksh(totals.amount)}</span>
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
            title={it ? `${ksh(it.amountCents)} · ${it.businessName}` : ""}
            facts={
              it
                ? [
                    { label: "Amount", value: ksh(it.amountCents) },
                    { label: "Status", value: <StatusPill tone={statusTone(it)}>{displayStatus(it)}</StatusPill> },
                    { label: "Business", value: it.businessName },
                    { label: "Invoice", value: it.invoiceNumber || "None linked" },
                    { label: "Paid on", value: it.paidAt ? day(it.paidAt) : "Not set" },
                    { label: "Recorded", value: day(it.createdAt) },
                    { label: "Reference", value: it.providerRef || "—" },
                  ]
                : undefined
            }
            related={
              it
                ? [
                    ...(it.invoiceId
                      ? [{ label: `Invoice ${it.invoiceNumber || it.invoiceId}`, href: `/admin/billing/invoices?pane=${it.invoiceId}` }]
                      : []),
                    ...(it.businessId
                      ? [
                          {
                            label: "All invoices for this business",
                            href: `/admin/billing/invoices?business=${it.businessId}`,
                          },
                          { label: "Business money", href: businessPaneHref(it.businessId, "money") },
                        ]
                      : []),
                  ]
                : undefined
            }
            footer={
              it ? (
                <div className="flex w-full flex-col gap-ops-2" data-payment-actions="">
                  <p id="payment-actions-why" className="text-ops-label text-ink-2" data-blocked-why="">
                    {PAYMENT_ACTION_WHY.collect}
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled
                      aria-describedby="payment-actions-why"
                      title={PAYMENT_ACTION_WHY.void}
                      data-action="void"
                    >
                      Void
                    </Button>
                    <Button
                      type="button"
                      variant="tonal"
                      size="sm"
                      disabled
                      aria-describedby="payment-actions-why"
                      title={PAYMENT_ACTION_WHY.record}
                      data-action="record"
                    >
                      Record
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled
                      aria-describedby="payment-actions-why"
                      title={PAYMENT_ACTION_WHY.collect}
                      data-action="collect"
                    >
                      Collect
                    </Button>
                    {it.businessId ? (
                      <ButtonLink href={businessPaneHref(it.businessId, "money")} variant="tonal" size="sm">
                        Open business
                      </ButtonLink>
                    ) : null}
                  </div>
                </div>
              ) : undefined
            }
          />
        }
      />
      <span className="sr-only" data-now={nowIso} />
    </div>
  );
}
