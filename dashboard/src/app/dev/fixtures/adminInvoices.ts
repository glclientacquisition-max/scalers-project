import type { InvoiceRow } from "@/lib/ops/invoicesView";
import { ADMIN_BUSINESSES } from "./adminBusinesses";

/** Synthetic invoices: made-up numbers and amounts, no real business. */
export const ADMIN_INVOICES_NOW = "2026-10-22T09:00:00Z";
const STATUSES = ["open", "open", "paid", "open", "paid", "draft", "open", "void", "paid", "open", "uncollectible", "paid"];
export const ADMIN_INVOICES: InvoiceRow[] = Array.from({ length: 88 }, (_, i) => {
  const b = ADMIN_BUSINESSES[i % 22];
  const status = STATUSES[i % STATUSES.length];
  const total = (2500 + ((i * 1370) % 9000)) * 100;
  const start = new Date(Date.UTC(2026, 9 - Math.floor(i / 12), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const due = new Date(start.getTime() + (7 + (i % 20)) * 86400000);
  return {
    id: `inv-${i}`,
    number: status === "draft" ? "Draft" : `SCL-2026-${String(180 - i).padStart(4, "0")}`,
    businessId: b.id,
    businessName: b.business_name,
    status,
    totalCents: total,
    paidCents: status === "paid" ? total : i % 4 === 3 ? Math.round(total / 2) : 0,
    dueAt: due.toISOString(),
    issuedAt: status === "draft" ? null : start.toISOString(),
    paidAt: status === "paid" ? new Date(due.getTime() - 2 * 86400000).toISOString() : null,
    createdAt: new Date(start.getTime() - 3600000).toISOString(),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    lines: [
      { description: `${b.package_name || "Starter"} package, ${start.toLocaleString("en-KE", { month: "long", timeZone: "UTC" })}`, amountCents: Math.round(total * 0.8) },
      { description: "On-demand minutes", amountCents: total - Math.round(total * 0.8) },
    ],
  };
});
