"use client";

import { useMemo, useState } from "react";
import type { AdminBillingOverview, AdminBillingRow } from "@/lib/adminBillingTypes";
import { modeName as adminModeLabel } from "@/lib/adminBillingCopy";
import {
  attentionRows,
  filterAttentionKind,
  rowPreviewLine,
  rowWhenLabel,
  sortBillingQueue,
  stampToneForBillingStatus,
  type BillingAttentionKind,
} from "@/lib/adminBillingHub";
import { AdminBillingFilterChips, buildFilterChips } from "@/components/AdminBillingFilterChips";
import { CheckoutReviewResolve } from "@/components/CheckoutReviewResolve";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { ButtonLink } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/Pagination";
import { Segmented } from "@/components/ui/Segmented";
import { Stamp } from "@/components/ui/Stamp";
import { numberLabel, searchableNumber } from "@/lib/adminBillingCopy";
import type { AttentionItem } from "@/lib/adminPayCopy";

type BillingFilter = "all" | "needs" | "attention" | "beta" | "charging";

function shopMoneyHref(id: string) {
  return `/admin/businesses/${id}?money=1`;
}

function PeriodLine({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <p className="px-4 text-meta text-ink-2">
      Period ends <span className="font-medium text-ink">{label}</span>
    </p>
  );
}

function OpenInvoicesRow({ overview }: { overview: AdminBillingOverview }) {
  if (overview.invoicesMissing) return null;
  const overdue = overview.overdueInvoiceCount > 0;
  return (
    <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Open invoices">
      <ListRow
        href="/admin/billing/invoices"
        title={`${overview.openInvoiceKesLabel} open`}
        preview={
          overdue
            ? `${overview.openInvoiceCount} invoices · ${overview.overdueInvoiceCount} overdue`
            : `${overview.openInvoiceCount} invoices`
        }
        stamp={overdue ? <Stamp tone="attention">Overdue</Stamp> : undefined}
      />
    </ul>
  );
}

function ReviewQueue({
  warning,
  reviews,
  rows,
  empty,
}: {
  warning: string | null;
  reviews: NonNullable<AttentionItem["review"]>[];
  rows: AttentionItem[];
  empty: boolean;
}) {
  if (empty && !warning) {
    return <Empty title="No reviews." line="Checkout and payment reviews." />;
  }
  return (
    <div className="space-y-3">
      {warning ? (
        <p className="px-4 text-ops-body text-attention" role="alert">
          {warning}
        </p>
      ) : null}
      <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Reviews">
        <CheckoutReviewResolve reviews={reviews} showBusiness />
        {rows.map((item) => (
          <ListRow key={item.id} href={item.href} title={item.title} preview={item.preview} when={item.when} />
        ))}
      </ul>
    </div>
  );
}

export function AdminBillingListPanel({
  overview,
  attention = [],
  attentionWarning = null,
  initialFilter = "all",
}: {
  overview: AdminBillingOverview;
  attention?: AttentionItem[];
  attentionWarning?: string | null;
  initialFilter?: BillingFilter;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BillingFilter>(initialFilter);
  const [waitKind, setWaitKind] = useState<BillingAttentionKind | null>(null);
  const [page, setPage] = useState(1);

  const liveRows = useMemo(
    () => overview.rows.filter((r) => r.status !== "archived"),
    [overview.rows],
  );
  const needs = useMemo(() => attentionRows(overview.rows), [overview.rows]);
  const chips = useMemo(
    () => buildFilterChips(needs, overview.rolloverSoonCount),
    [needs, overview.rolloverSoonCount],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = liveRows;

    if (filter === "needs") {
      base =
        waitKind === "rollover_soon"
          ? filterAttentionKind(overview.rows, "rollover_soon")
          : waitKind
            ? filterAttentionKind(needs, waitKind)
            : needs;
    } else if (filter === "all" && waitKind) {
      base = filterAttentionKind(base, waitKind);
    } else if (filter === "beta") {
      base = base.filter((r) => r.billing_enforcement === "off");
    } else if (filter === "charging") {
      base = base.filter((r) => r.billing_enforcement !== "off");
    }

    if (q) {
      base = base.filter(
        (r) =>
          r.business_name.toLowerCase().includes(q) ||
          searchableNumber(r.sautikit_virtual_number).includes(q) ||
          (r.packageName || "").toLowerCase().includes(q),
      );
    }

    return sortBillingQueue(base);
  }, [overview.rows, liveRows, query, filter, waitKind, needs]);

  const attentionFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attention;
    return attention.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.preview.toLowerCase().includes(q) ||
        (item.review?.businessName || "").toLowerCase().includes(q),
    );
  }, [attention, query]);

  const reviewRows = attentionFiltered.flatMap((item) => (item.review ? [item.review] : []));
  const otherAttention = attentionFiltered.filter((item) => !item.review);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * DEFAULT_PAGE_SIZE, safePage * DEFAULT_PAGE_SIZE);

  function selectFilter(next: BillingFilter) {
    setFilter(next);
    setWaitKind(null);
    setQuery("");
    setPage(1);
  }

  function toggleWaitKind(kind: FilterChipKind) {
    setWaitKind((prev) => (prev === kind ? null : kind));
    setQuery("");
    setPage(1);
  }

  const showShopList = filter !== "attention";
  const showChips = filter === "all" || filter === "needs";

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4">
        <PeriodLine label={overview.platformPeriodEndLabel} />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <ButtonLink href="/admin/billing/invoices" size="sm" variant="ghost">
            Invoices
          </ButtonLink>
          <ButtonLink href="/admin/packages" size="sm" variant="tonal">
            Plans
          </ButtonLink>
        </div>
      </div>

      <OpenInvoicesRow overview={overview} />

      <Segmented
        className="px-4"
        label="Billing view"
        items={[
          { key: "all", label: "All", count: liveRows.length, active: filter === "all" },
          { key: "needs", label: "Waiting", count: needs.length, active: filter === "needs" },
          { key: "attention", label: "Reviews", count: attention.length, active: filter === "attention" },
          { key: "beta", label: "Beta", count: overview.betaCount, active: filter === "beta" },
          { key: "charging", label: "Charging", count: overview.chargingCount, active: filter === "charging" },
        ]}
        onSelect={(key) => selectFilter(key as BillingFilter)}
      />

      {filter === "all" ? (
        <p className="px-4 text-meta tabular-nums text-ink-2">
          {overview.betaCount} beta · {overview.chargingCount} charging
        </p>
      ) : null}

      {showChips && chips.some((c) => c.count > 0) ? (
        <AdminBillingFilterChips chips={chips} active={waitKind} onSelect={toggleWaitKind} />
      ) : null}

      {filter === "attention" ? (
        <>
          <label className="block px-4 text-ops-body">
            <span className="sr-only">Search reviews</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={deskFieldClass}
              placeholder="Shop or issue"
            />
          </label>
          <ReviewQueue
            warning={attentionWarning}
            reviews={reviewRows}
            rows={otherAttention}
            empty={attentionFiltered.length === 0}
          />
        </>
      ) : null}

      {showShopList ? (
        <>
          <label className="block px-4 text-ops-body">
            <span className="sr-only">Search shops</span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className={deskFieldClass}
              placeholder="Shop, number, or plan"
            />
          </label>

          {filtered.length === 0 ? (
            <Empty
              title={filter === "needs" ? "No shops waiting." : "No shops match."}
              line={filter === "needs" ? "Shops with no plan, low minutes, or none left." : "Try another name or number."}
              action={
                filter === "needs" ? (
                  <ButtonLink href="/admin/businesses" size="sm" variant="tonal">
                    Businesses
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Billing shops">
                {pageRows.map((r) => (
                  <BillingQueueRow key={r.id} row={r} />
                ))}
              </ul>
              <Pagination
                page={safePage}
                pageSize={DEFAULT_PAGE_SIZE}
                total={filtered.length}
                noun="shop"
                onPage={setPage}
                className="px-4 py-3"
              />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

type FilterChipKind = Exclude<BillingAttentionKind, "all">;

function BillingQueueRow({ row }: { row: AdminBillingRow }) {
  const preview = rowPreviewLine(row, adminModeLabel);
  const displayNumber = numberLabel(row.sautikit_virtual_number);
  const line =
    displayNumber === "Waiting for a number"
      ? preview
      : `${displayNumber} · ${row.packageName || "No plan"} · ${adminModeLabel(row.billing_enforcement)}`;

  return (
    <ListRow
      href={shopMoneyHref(row.id)}
      title={row.business_name}
      when={rowWhenLabel(row)}
      preview={line}
      stamp={<Stamp tone={stampToneForBillingStatus(row.status)}>{row.statusLabel}</Stamp>}
    />
  );
}
