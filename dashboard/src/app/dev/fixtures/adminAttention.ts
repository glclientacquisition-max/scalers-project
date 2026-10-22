import { buildAttention } from "@/lib/ops/attentionView";
import { ADMIN_BUSINESSES } from "./adminBusinesses";

const businesses = ADMIN_BUSINESSES.map((b) => ({ id: b.id, name: b.business_name, status: b.status, createdAt: b.created_at }));
const pick = (i: number) => ADMIN_BUSINESSES[i].id;

/** Synthetic queue: invoices, waits, package use and quality, all made up. */
export const ADMIN_ATTENTION = buildAttention({
  businesses,
  now: new Date("2026-10-22T09:00:00Z"),
  overdue: [
    { id: "inv-a", tenantId: pick(1), number: "INV-2026-0141", owedCents: 450000, dueAt: "2026-10-08T21:00:00Z" },
    { id: "inv-b", tenantId: pick(5), number: "INV-2026-0152", owedCents: 120000, dueAt: "2026-10-15T21:00:00Z" },
    { id: "inv-c", tenantId: pick(9), number: "INV-2026-0160", owedCents: 290000, dueAt: "2026-10-19T21:00:00Z" },
    { id: "inv-d", tenantId: pick(14), number: "INV-2026-0163", owedCents: 75000, dueAt: "2026-10-21T21:00:00Z" },
    { id: "inv-e", tenantId: pick(17), number: "INV-2026-0166", owedCents: 310000, dueAt: "2026-10-12T21:00:00Z" },
    ...[18, 19, 20, 21, 23, 0, 2].map((i, n) => ({
      id: `inv-${i}`,
      tenantId: pick(i),
      number: `INV-2026-01${70 + n}`,
      owedCents: 60000 + n * 35000,
      dueAt: new Date(Date.UTC(2026, 9, 2 + n * 2, 21)).toISOString(),
    })),
  ],
  usage: [
    ...[15, 18, 19, 20, 21].map((i, n) => ({ tenantId: pick(i), includedMinutes: 1000, usedSeconds: 48600 + n * 2400, packageName: "Growth" })),
    { tenantId: pick(0), includedMinutes: 500, usedSeconds: 31200, packageName: "Starter" },
    { tenantId: pick(2), includedMinutes: 1500, usedSeconds: 76500, packageName: "Business" },
    { tenantId: pick(6), includedMinutes: 1000, usedSeconds: 49800, packageName: "Business" },
    { tenantId: pick(13), includedMinutes: 1000, usedSeconds: 48600, packageName: "Growth" },
    { tenantId: pick(16), includedMinutes: 500, usedSeconds: 9000, packageName: "Starter" },
  ],
  quality: [
    { tenantId: pick(4), score: 6.8, reason: "Answer rate down" },
    { tenantId: pick(10), score: 7.2, reason: "More callers asking for a person" },
  ],
});
