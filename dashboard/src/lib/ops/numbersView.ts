import type { OpsTone } from "@/components/ops/StatusPill";

/** One pool number as Numbers v2 shows it. No supplier ids on screen. */
export type NumberRow = {
  id: string;
  e164: string;
  status: string;
  businessId: string | null;
  businessName: string | null;
  businessActive: boolean | null;
  assignedAt: string | null;
  createdAt: string;
  notes: string | null;
  holdUntil: string | null;
  heldAt: string | null;
  lastBusinessId: string | null;
  lastBusinessName: string | null;
  /** True while quarantine is a win-back hold for lastBusinessId (#885). */
  winbackHold: boolean;
};

export type WaitingBusiness = { id: string; name: string; since: string };

/** A business a live number can move to: active, not archived or suspended, no line of its own. */
export type MoveTarget = { id: string; name: string };

export type NumberView = "available" | "assigned" | "held" | "disabled" | "all";
/** Four segments. Disabled stays inside All. */
export const NUMBER_VIEWS: { id: NumberView; label: string }[] = [
  { id: "available", label: "Free" },
  { id: "assigned", label: "Assigned" },
  { id: "held", label: "On hold" },
  { id: "all", label: "All" },
];

/** A quarantine whose end date has passed is free again (assign already accepts it). */
export function isHeld(r: NumberRow, now: Date): boolean {
  if (r.status !== "quarantine") return false;
  return !r.holdUntil || new Date(r.holdUntil).getTime() > now.getTime();
}

export function numberState(r: NumberRow, now: Date): Exclude<NumberView, "all"> {
  if (r.status === "assigned") return "assigned";
  if (r.status === "disabled") return "disabled";
  if (r.status === "quarantine") return isHeld(r, now) ? "held" : "available";
  if (r.status === "reserved") return "held";
  return "available";
}

export function inNumberView(r: NumberRow, v: NumberView, now: Date): boolean {
  return v === "all" || numberState(r, now) === v;
}

export function numberCounts(rows: NumberRow[], now: Date): Record<NumberView, number> {
  const c: Record<NumberView, number> = { available: 0, assigned: 0, held: 0, disabled: 0, all: rows.length };
  for (const r of rows) c[numberState(r, now)] += 1;
  return c;
}

/** Opens on Available when there is stock and a business is waiting; else Assigned. */
export function defaultNumberView(rows: NumberRow[], waiting: number, now: Date): NumberView {
  const c = numberCounts(rows, now);
  if (waiting > 0 && c.available > 0) return "available";
  return c.assigned > 0 ? "assigned" : "all";
}

export function statusLabel(r: NumberRow, now: Date): string {
  if (r.status === "reserved") return "Reserved";
  const s = numberState(r, now);
  if (s === "held" && r.winbackHold) return "Win-back hold";
  return s === "available" ? "Available" : s === "assigned" ? "Assigned" : s === "held" ? "On hold" : "Disabled";
}

export function numberTone(r: NumberRow, now: Date): OpsTone {
  const s = numberState(r, now);
  if (s === "assigned") return r.businessActive === false ? "warn" : "ok";
  if (s === "held") return "info";
  if (s === "disabled") return "neutral";
  return "beta";
}

/** "+254709100201" → "+254 709 100 201". */
export function formatE164(e164: string): string {
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function matchesNumber(r: NumberRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "").replace(/^0/, "");
  if (digits.length >= 3 && r.e164.replace(/\D/g, "").includes(digits)) return true;
  return [r.businessName, r.lastBusinessName].some((s) => (s || "").toLowerCase().includes(t));
}
