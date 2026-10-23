"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Stamp } from "@/components/ui/Stamp";
import type { AdminInvoiceListRow } from "@/lib/adminPayCopy";

type InvoiceFilter = "all" | "open" | "paid" | "draft" | "closed";

function matches(row: AdminInvoiceListRow, filter: InvoiceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return row.status === "void" || row.status === "uncollectible";
  return row.status === filter;
}

export function AdminInvoiceList({
  rows,
  truncated = false,
  businessName = null,
  initialFilter = "all",
}: {
  rows: AdminInvoiceListRow[];
  truncated?: boolean;
  businessName?: string | null;
  initialFilter?: InvoiceFilter;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InvoiceFilter>(initialFilter);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matches(row, filter)) return false;
      if (!q) return true;
      return row.number.toLowerCase().includes(q) || row.businessName.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  const count = (key: InvoiceFilter) => rows.filter((row) => matches(row, key)).length;

  return (
    <div className="space-y-6">
      {businessName ? (
        <p className="px-4 text-ops-body text-ink-2">
          {businessName}.{" "}
          <Link href="/admin/billing/invoices" className="font-medium text-accent underline-offset-2 hover:underline">
            All invoices
          </Link>
        </p>
      ) : null}
      <Segmented
        className="px-4"
        label="Invoice status"
        items={[
          { key: "all", label: "All", count: count("all"), active: filter === "all" },
          { key: "open", label: "Open", count: count("open"), active: filter === "open" },
          { key: "paid", label: "Paid", count: count("paid"), active: filter === "paid" },
          { key: "draft", label: "Draft", count: count("draft"), active: filter === "draft" },
          { key: "closed", label: "Closed", count: count("closed"), active: filter === "closed" },
        ]}
        onSelect={(key) => setFilter(key as InvoiceFilter)}
      />
      <label className="block px-4 text-ops-body">
        Search
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`mt-1 ${deskFieldClass}`}
          placeholder="Number or business"
        />
      </label>
      {truncated ? <p className="px-4 text-meta text-ink-3">Latest 200.</p> : null}
      {filtered.length === 0 ? (
        <Empty
          title={rows.length === 0 ? "No invoices." : "No invoices match."}
          line={rows.length === 0 ? "Issued invoices show here with an SCL number." : "Widen the filter or search."}
        />
      ) : (
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label="Invoices">
          {filtered.map((row) => (
            <ListRow
              key={row.id}
              href={`/admin/billing/invoices/${row.id}`}
              title={<span className="tabular-nums">{row.number}</span>}
              when={row.created}
              stamp={<Stamp tone={row.tone}>{row.statusLabel}</Stamp>}
              preview={
                <span className="tabular-nums">
                  {row.businessName} · {row.total} · paid {row.paid} · {row.due}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
