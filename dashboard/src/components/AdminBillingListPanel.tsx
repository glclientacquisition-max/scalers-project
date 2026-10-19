"use client";

import { useMemo, useState } from "react";
import { adminModeLabel, type AdminBillingOverview, type AdminBillingRow } from "@/lib/adminBilling";
import {
  attentionRows,
  filterAttentionKind,
  hubTotals,
  rowPreviewLine,
  rowWhenLabel,
  sortBillingQueue,
  stampToneForBillingStatus,
  type BillingAttentionKind,
} from "@/lib/adminBillingHub";
import { AdminBillingNeedsCards, buildNeedsCards } from "@/components/AdminBillingNeedsCards";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { ButtonLink } from "@/components/ui/Button";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Stamp } from "@/components/ui/Stamp";
import { numberLabel } from "@/lib/adminBillingCopy";

type BillingFilter = "needs" | "all" | "beta" | "charging";

function shopMoneyHref(id: string) {
  return `/admin/businesses/${id}?money=1`;
}

function MixBar({ beta, charging }: { beta: number; charging: number }) {
  const total = Math.max(beta + charging, 1);
  const betaPct = Math.round((beta / total) * 100);
  const chargePct = 100 - betaPct;
  return (
    <div className="space-y-2" aria-label="Beta vs charging mix">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="bg-brand/80 transition-[width] duration-fast ease-out" style={{ width: `${betaPct}%` }} />
        <div className="bg-accent/90 transition-[width] duration-fast ease-out" style={{ width: `${chargePct}%` }} />
      </div>
      <div className="flex justify-between text-meta text-ink-2 tabular-nums">
        <span>Beta {beta}</span>
        <span>Charging {charging}</span>
      </div>
    </div>
  );
}

function HubStat({
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
    <div className="rounded-2xl border border-hairline/70 bg-surface px-4 py-3">
      <p className={`text-title tabular-nums ${warn ? "text-attention" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 text-meta text-ink-2">{label}</p>
      {hint ? <p className="mt-1 text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}

function AdminBillingSnapshot({
  overview,
  totals,
  noPackageCount,
}: {
  overview: AdminBillingOverview;
  totals: ReturnType<typeof hubTotals>;
  noPackageCount: number;
}) {
  return (
    <section className="space-y-4 px-4" aria-label="Platform billing snapshot">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HubStat label="Active shops" value={totals.activeCount} />
        <HubStat label="Needs you" value={totals.needsCount} warn={totals.needsCount > 0} />
        <HubStat
          label="Minutes used"
          value={totals.minutesUsed.toLocaleString("en-KE")}
          hint={`${totals.minutesIncluded.toLocaleString("en-KE")} included`}
        />
        <HubStat label="Owner opted in" value={totals.onDemandCount} hint="On-demand overage" />
      </div>
      <div className="rounded-2xl border border-hairline/70 bg-surface-2/40 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-body font-medium text-ink">Commercial mix</p>
          <p className="text-meta text-ink-2 tabular-nums">
            {overview.lowMinutesCount} low · {overview.exhaustedCount} exhausted · {noPackageCount} no package
          </p>
        </div>
        <MixBar beta={overview.betaCount} charging={overview.chargingCount} />
      </div>
    </section>
  );
}

export function AdminBillingListPanel({ overview }: { overview: AdminBillingOverview }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BillingFilter>("needs");
  const [attentionKind, setAttentionKind] = useState<BillingAttentionKind | null>(null);

  const totals = useMemo(() => hubTotals(overview.rows), [overview.rows]);
  const needs = useMemo(() => attentionRows(overview.rows), [overview.rows]);
  const needsCards = useMemo(() => buildNeedsCards(needs), [needs]);

  const noPackageCount = useMemo(
    () => overview.rows.filter((r) => r.status !== "archived" && !r.packageName).length,
    [overview.rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = overview.rows.filter((r) => r.status !== "archived");

    if (filter === "needs") {
      if (!attentionKind) return [];
      base = filterAttentionKind(needs, attentionKind);
    } else if (filter === "beta") {
      base = base.filter((r) => r.billing_enforcement === "off");
    } else if (filter === "charging") {
      base = base.filter((r) => r.billing_enforcement !== "off");
    }

    if (q) {
      base = base.filter(
        (r) =>
          r.business_name.toLowerCase().includes(q) ||
          numberLabel(r.sautikit_virtual_number).toLowerCase().includes(q) ||
          (r.packageName || "").toLowerCase().includes(q),
      );
    }

    return sortBillingQueue(base);
  }, [overview.rows, query, filter, attentionKind, needs]);

  function selectFilter(next: BillingFilter) {
    setFilter(next);
    setAttentionKind(null);
    setQuery("");
  }

  function toggleAttentionKind(kind: BillingAttentionKind) {
    setAttentionKind((prev) => (prev === kind ? null : kind));
    setQuery("");
  }

  const activeNeedsCard = needsCards.find((c) => c.kind === attentionKind);

  return (
    <div className="space-y-5 pb-6">
      <div className="flex justify-end px-4">
        <ButtonLink href="/admin/packages" size="sm" variant="tonal" leading={<Squares2X2Icon className="h-5 w-5" aria-hidden />}>
          Catalog
        </ButtonLink>
      </div>

      <Segmented
        className="px-4"
        label="Billing view"
        items={[
          { key: "needs", label: "Needs you", count: needs.length, active: filter === "needs" },
          {
            key: "all",
            label: "All",
            count: overview.rows.filter((r) => r.status !== "archived").length,
            active: filter === "all",
          },
          { key: "beta", label: "Beta", count: overview.betaCount, active: filter === "beta" },
          { key: "charging", label: "Charging", count: overview.chargingCount, active: filter === "charging" },
        ]}
        onSelect={(key) => selectFilter(key as BillingFilter)}
      />

      {filter === "needs" ? (
        <>
          <div className="px-4">
            <div className="rounded-2xl border border-hairline/70 bg-surface-2/40 p-4">
              <p className="text-body font-medium text-ink">Commercial mix</p>
              <div className="mt-3">
                <MixBar beta={overview.betaCount} charging={overview.chargingCount} />
              </div>
            </div>
          </div>

          {needs.length === 0 ? (
            <Empty
              title="Nothing needs you."
              line="Beta and charging shops are within limits."
              action={
                <ButtonLink href="/admin/businesses" size="sm" variant="tonal">
                  Businesses
                </ButtonLink>
              }
            />
          ) : (
            <>
              <AdminBillingNeedsCards cards={needsCards} active={attentionKind} onSelect={toggleAttentionKind} />
              {!attentionKind ? (
                <p className="px-4 text-body text-ink-2">Pick a queue to see shops.</p>
              ) : null}
            </>
          )}
        </>
      ) : (
        <AdminBillingSnapshot overview={overview} totals={totals} noPackageCount={noPackageCount} />
      )}

      {filter !== "needs" || attentionKind ? (
        <>
          {filter === "needs" && activeNeedsCard ? (
            <div className="flex items-center justify-between gap-3 px-4">
              <p className="text-body font-medium text-ink">
                {activeNeedsCard.label}
                <span className="ms-2 tabular-nums text-ink-2">({filtered.length})</span>
              </p>
              <button
                type="button"
                className="text-meta font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => setAttentionKind(null)}
              >
                Clear
              </button>
            </div>
          ) : null}

          <label className="block px-4 text-body">
            <span className="sr-only">Search businesses</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={deskFieldClass}
              placeholder="Business, number, or package"
            />
          </label>

          {filtered.length === 0 ? (
            <Empty
              title={filter === "needs" ? "No shops in this queue." : "No businesses match."}
              line={filter === "needs" ? "Try another queue or clear the filter." : "Widen your filter or search."}
            />
          ) : (
            <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Billing queue">
              {filtered.map((r) => (
                <BillingQueueRow key={r.id} row={r} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function BillingQueueRow({ row }: { row: AdminBillingRow }) {
  const preview = rowPreviewLine(row, adminModeLabel);
  const displayNumber = numberLabel(row.sautikit_virtual_number);
  const line =
    displayNumber === "Waiting for a number"
      ? preview
      : `${displayNumber} · ${row.packageName || "Unassigned"} · ${adminModeLabel(row.billing_enforcement)}`;

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
