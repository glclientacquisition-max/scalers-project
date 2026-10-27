import type { MoveTarget, NumberRow, WaitingBusiness } from "@/lib/ops/numbersView";
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

/** Businesses with no line of their own (Move targets). Synthetic. */
export const ADMIN_NUMBERS_MOVE_TARGETS: MoveTarget[] = ADMIN_NUMBERS_WAITING.map((w) => ({ id: w.id, name: w.name }));

/** A plain quarantine (released, not a win-back hold): Make available now and Bring back. Synthetic. */
export const ADMIN_NUMBERS_PLAIN_HOLD: NumberRow = {
  id: "num-plain-hold",
  e164: "+254709100990",
  status: "quarantine",
  businessId: null,
  businessName: null,
  businessActive: null,
  assignedAt: null,
  createdAt: "2026-05-02T09:00:00Z",
  notes: null,
  holdUntil: "2026-11-21T10:52:00Z",
  heldAt: "2026-10-22T10:52:00Z",
  lastBusinessId: ADMIN_BUSINESSES[3].id,
  lastBusinessName: ADMIN_BUSINESSES[3].business_name,
  winbackHold: false,
};
