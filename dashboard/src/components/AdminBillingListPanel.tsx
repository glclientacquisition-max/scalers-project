"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  adminModeLabel,
  type AdminBillingOverview,
  type AdminBillingRow,
} from "@/lib/adminBilling";
import { CheckoutReviewResolve } from "@/components/CheckoutReviewResolve";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { numberLabel, searchableNumber } from "@/lib/adminBillingCopy";
import type { AttentionItem } from "@/lib/adminPayCopy";
import { usedOfIncluded } from "@/lib/packageUsageAlign";

type BillingFilter = "needs" | "attention" | "all" | "beta" | "charging";

function shopMoneyHref(id: string) {
  return `/admin/businesses/${id}?money=1`;
}

function MixBar({ beta, charging }: { beta: number; charging: number }) {
  const total = Math.max(beta + charging, 1);
  const betaPct = Math.round((beta / total) * 100);
  const chargePct = 100 - betaPct;
  return (
    <div className="space-y-2 px-4" aria-label="Beta vs charging mix">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="bg-brand/80" style={{ width: `${betaPct}%` }} title={`Beta ${beta}`} />
        <div className="bg-accent/90" style={{ width: `${chargePct}%` }} title={`Charging ${charging}`} />
      </div>
      <div className="flex justify-between text-meta text-ink-2 tabular-nums">
        <span>Beta · meter only {beta}</span>
        <span>Charging · on-demand {charging}</span>
      </div>
    </div>
  );
}

function attentionRows(rows: AdminBillingRow[]): AdminBillingRow[] {
  return rows.filter(
    (r) =>
      r.status !== "archived" &&
      (!r.packageName || r.status === "low_minutes" || r.status === "exhausted"),
  );
}

function queuePreview(r: AdminBillingRow): string {
  return [
    numberLabel(r.sautikit_virtual_number),
    r.packageName || "No package assigned",
    `${usedOfIncluded(r.minutesUsed, r.minutesIncluded)} min`,
    adminModeLabel(r.billing_enforcement),
  ].join(" · ");
}

export function AdminBillingListPanel({
  overview,
  attention = [],
  attentionWarning = null,
  initialFilter = "needs",
}: {
  overview: AdminBillingOverview;
  attention?: AttentionItem[];
  attentionWarning?: string | null;
  initialFilter?: BillingFilter;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BillingFilter>(initialFilter);

  const noPackageCount = useMemo(
    () => overview.rows.filter((r) => r.status !== "archived" && !r.packageName).length,
    [overview.rows],
  );

  const minutesTotal = useMemo(
    () => overview.rows.reduce((sum, r) => sum + r.minutesUsed, 0),
    [overview.rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = overview.rows.filter((r) => r.status !== "archived");
    if (filter === "needs") base = attentionRows(overview.rows);
    else if (filter === "beta") base = base.filter((r) => r.billing_enforcement === "off");
    else if (filter === "charging") base = base.filter((r) => r.billing_enforcement !== "off");

    if (!q) return base;
    return base.filter(
      (r) =>
        r.business_name.toLowerCase().includes(q) ||
        searchableNumber(r.sautikit_virtual_number).includes(q) ||
        (r.packageName || "").toLowerCase().includes(q),
    );
  }, [overview.rows, query, filter]);

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

  return (
    <div className="space-y-6">
      <Segmented
        className="px-4"
        label="Billing view"
        items={[
          { key: "needs", label: "Needs you", count: attentionRows(overview.rows).length, active: filter === "needs" },
          { key: "attention", label: "Needs attention", count: attention.length, active: filter === "attention" },
          { key: "all", label: "All", count: overview.rows.filter((r) => r.status !== "archived").length, active: filter === "all" },
          { key: "beta", label: "Beta", count: overview.betaCount, active: filter === "beta" },
          { key: "charging", label: "Charging", count: overview.chargingCount, active: filter === "charging" },
        ]}
        onSelect={(key) => setFilter(key as BillingFilter)}
      />

      <section className="space-y-3 border-y border-hairline/70 py-4" aria-label="Platform billing metrics">
        <MixBar beta={overview.betaCount} charging={overview.chargingCount} />
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4">
          <Metric label="No package" value={noPackageCount} warn={noPackageCount > 0} />
          <Metric label="Low minutes" value={overview.lowMinutesCount} warn={overview.lowMinutesCount > 0} />
          <Metric label="Exhausted" value={overview.exhaustedCount} warn={overview.exhaustedCount > 0} />
          <Metric
            label="Minutes used"
            value={minutesTotal.toLocaleString("en-KE")}
            hint="All businesses this period"
          />
        </div>
      </section>

      <p className="px-4 text-body text-ink-2">
        Open a business shop for package, plan, and charges.{" "}
        <Link href="/admin/billing/invoices" className="font-medium text-accent underline-offset-2 hover:underline">
          Invoices
        </Link>
        ,{" "}
        <Link href="/admin/billing/payments" className="font-medium text-accent underline-offset-2 hover:underline">
          Payments
        </Link>
        , and{" "}
        <Link href="/admin/packages" className="font-medium text-accent underline-offset-2 hover:underline">
          Catalog
        </Link>{" "}
        prices sit beside this queue.
      </p>

      <label className="block px-4 text-body">
        Search
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`mt-1 ${deskFieldClass}`}
          placeholder="Business, number, or package"
        />
      </label>

      {filter === "attention" ? (
        <AttentionQueue
          warning={attentionWarning}
          reviews={reviewRows}
          rows={otherAttention}
          empty={attentionFiltered.length === 0}
        />
      ) : filtered.length === 0 ? (
        <Empty
          title={filter === "needs" ? "Nothing needs you." : "No businesses match."}
          line={filter === "needs" ? "Check All for the full list." : "Widen your filter or search."}
        />
      ) : (
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Billing queue">
          {filtered.map((r) => (
            <ListRow
              key={r.id}
              href={shopMoneyHref(r.id)}
              title={r.business_name}
              when={r.statusLabel}
              preview={queuePreview(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttentionQueue({
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
    return (
      <Empty
        title="Nothing needs attention."
        line="Checkout reviews, unmatched payments, retries, and held checkouts show here."
      />
    );
  }
  return (
    <div className="space-y-3">
      {warning ? (
        <p className="px-4 text-body text-attention" role="alert">
          {warning}
        </p>
      ) : null}
      <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Needs attention">
        <CheckoutReviewResolve reviews={reviews} showBusiness />
        {rows.map((item) => (
          <ListRow key={item.id} href={item.href} title={item.title} preview={item.preview} when={item.when} />
        ))}
      </ul>
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
  hint,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <p className={`text-body font-medium tabular-nums ${warn ? "text-attention" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 text-meta text-ink-2">{label}</p>
      {hint ? <p className="text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}
