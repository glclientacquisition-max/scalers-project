import type { NumberRow, WaitingBusiness } from "@/lib/ops/numbersView";
import { ADMIN_BUSINESSES } from "./adminBusinesses";

/** Synthetic pool numbers: made-up lines in an unused range, no real business. */
export const ADMIN_NUMBERS_NOW = "2026-10-22T09:00:00Z";
const STATUS = ["assigned", "assigned", "available", "assigned", "quarantine", "assigned", "available", "disabled", "assigned", "reserved", "assigned", "quarantine"];
export const ADMIN_NUMBERS: NumberRow[] = Array.from({ length: 84 }, (_, i) => {
  const status = STATUS[i % STATUS.length];
  const b = ADMIN_BUSINESSES[i % 21];
  const last = ADMIN_BUSINESSES[(i + 5) % 20];
  const created = new Date(Date.UTC(2026, 2 + (i % 6), 1 + (i % 25))).toISOString();
  const held = status === "quarantine";
  return {
    id: `num-${i}`,
    e164: `+254709100${String(200 + i)}`,
    status,
    businessId: status === "assigned" ? b.id : null,
    businessName: status === "assigned" ? b.business_name : null,
    businessActive: status === "assigned" ? i % 7 !== 3 : null,
    assignedAt: status === "assigned" ? new Date(Date.parse(created) + 9 * 86400000).toISOString() : null,
    createdAt: created,
    notes: null,
    holdUntil: held ? new Date(Date.parse(ADMIN_NUMBERS_NOW) + (i % 24 < 12 ? 4 + (i % 9) : -3) * 86400000).toISOString() : null,
    heldAt: held ? new Date(Date.parse(ADMIN_NUMBERS_NOW) - 18 * 86400000).toISOString() : null,
    lastBusinessId: held ? last.id : null,
    lastBusinessName: held ? last.business_name : null,
    winbackHold: held && i % 3 !== 0,
  };
});
export const ADMIN_NUMBERS_WAITING: WaitingBusiness[] = [
  { id: ADMIN_BUSINESSES[21].id, name: ADMIN_BUSINESSES[21].business_name, since: "2026-10-18T07:00:00Z" },
  { id: ADMIN_BUSINESSES[22].id, name: ADMIN_BUSINESSES[22].business_name, since: "2026-10-20T07:00:00Z" },
  { id: ADMIN_BUSINESSES[23].id, name: ADMIN_BUSINESSES[23].business_name, since: "2026-10-21T12:00:00Z" },
];
