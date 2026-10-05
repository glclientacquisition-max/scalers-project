"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  chargingModeLabel,
  type AdminBillingOverview,
  type AdminBillingRow,
} from "@/lib/adminBilling";
import { adminRowActionClass, adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { deskFieldClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import { usedOfIncluded } from "@/lib/packageUsageAlign";

type BillingFilter = "all" | "beta" | "charging" | "low" | "exhausted";

const FILTER_OPTIONS: { value: BillingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "beta", label: "Beta only" },
  { value: "charging", label: "Charging only" },
  { value: "low", label: "Low minutes" },
  { value: "exhausted", label: "Exhausted" },
];

function overageLine(row: AdminBillingRow): string {
  if (row.wallet_balance_kes < 0) {
    return `Overage KES ${Math.abs(row.wallet_balance_kes).toLocaleString("en-KE")}`;
  }
  if (row.billing_enforcement !== "off" && row.minutesRemaining <= 0 && row.on_demand_usage_enabled) {
    return "On-demand active";
  }
  return "—";
}

export function AdminBillingListPanel({ overview }: { overview: AdminBillingOverview }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BillingFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview.rows.filter((r) => {
      if (filter === "beta" && r.billing_enforcement !== "off") return false;
      if (filter === "charging" && r.billing_enforcement === "off") return false;
      if (filter === "low" && r.status !== "low_minutes") return false;
      if (filter === "exhausted" && r.status !== "exhausted") return false;
      if (!q) return true;
      return (
        r.business_name.toLowerCase().includes(q) ||
        r.sautikit_virtual_number.toLowerCase().includes(q) ||
        (r.packageName || "").toLowerCase().includes(q)
      );
    });
  }, [overview.rows, query, filter]);

  return (
    <div className="space-y-4">
      <section
        className="grid grid-cols-2 border-y border-line/70 sm:grid-cols-4"
        aria-label="Billing totals"
      >
        <Kpi label="Beta (free)" value={overview.betaCount} />
        <Kpi label="Charging" value={overview.chargingCount} />
        <Kpi label="Low minutes" value={overview.lowMinutesCount} warn={overview.lowMinutesCount > 0} />
        <Kpi label="Exhausted" value={overview.exhaustedCount} warn={overview.exhaustedCount > 0} />
      </section>

      <p className="text-sm text-ink-2">
        Observe every client: package minutes, on-demand charging mode, and overage. Edit SKUs, rates, and
        assignments on{" "}
        <Link href="/admin/packages" className="font-medium text-accent underline-offset-2 hover:underline">
          Packages
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="min-w-[200px] grow text-sm">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`mt-1 ${deskFieldClass}`}
            placeholder="Business, number, or package"
          />
        </label>
        <div className="text-sm">
          <span className="font-medium text-ink">Filter</span>
          <DeskSelect
            aria-label="Filter businesses"
            className={`mt-1 min-w-[11rem] ${deskFieldClass}`}
            portalThemeClass="admin-theme"
            value={filter}
            onChange={setFilter}
            options={FILTER_OPTIONS}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="text-ink-2">
            <tr className="border-b border-line/70">
              <th className={adminThClass}>Business</th>
              <th className={adminThClass}>Package</th>
              <th className={adminThClass}>Minutes</th>
              <th className={adminThClass}>Charging</th>
              <th className={adminThClass}>Overage</th>
              <th className={adminThClass}>Status</th>
              <th className={adminThClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty title="No businesses match." line="Widen your filter or assign a package from a client row." />
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-line/70">
                  <td className={adminTdClass}>
                    <p className={`text-body font-medium text-ink ${deskPreviewClass}`}>{r.business_name}</p>
                    <p className={`mt-0.5 text-meta text-ink-2 ${deskPreviewClass}`}>{r.sautikit_virtual_number}</p>
                  </td>
                  <td className={`${adminTdClass} text-ink-2`}>
                    {r.packageName || "No package"}
                    {r.period ? ` / ${r.period}` : ""}
                  </td>
                  <td className={`${adminTdClass} tabular-nums text-ink`}>
                    {usedOfIncluded(r.minutesUsed, r.minutesIncluded)}
                  </td>
                  <td className={`${adminTdClass} text-meta text-ink-2`}>
                    {chargingModeLabel(r.billing_enforcement)}
                  </td>
                  <td className={`${adminTdClass} text-meta text-ink-2`}>{overageLine(r)}</td>
                  <td className={`${adminTdClass} text-meta text-ink`}>{r.statusLabel}</td>
                  <td className={adminTdClass}>
                    <Link href={`/admin/billing/${r.id}`} className={adminRowActionClass}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="border-t border-line/70 px-3 py-2 sm:border-t-0 sm:border-l sm:px-4 sm:py-2.5 sm:first:border-l-0">
      <p className={`text-body font-medium tabular-nums ${warn ? "text-attention" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 truncate text-meta text-ink-2">{label}</p>
    </div>
  );
}
