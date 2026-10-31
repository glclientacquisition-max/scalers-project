import type { AdminBusiness } from "@/lib/admin";
import type { OpsTone } from "@/components/ops/StatusPill";

/** One row of four. All includes archived. Attention (waiting, suspended) sorts first. */
export const BUSINESS_VIEWS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "waiting", label: "Waiting" },
  { id: "suspended", label: "Suspended" },
] as const;
export type BusinessView = (typeof BUSINESS_VIEWS)[number]["id"];

const ATTENTION_RANK: Record<AdminBusiness["status"], number> = {
  waiting: 0,
  suspended: 1,
  active: 2,
  archived: 3,
};

export function inView(b: AdminBusiness, view: BusinessView): boolean {
  if (view === "all") return true;
  if (view === "live") return b.status === "active";
  return b.status === view;
}

export function defaultView(rows: AdminBusiness[]): BusinessView {
  void rows;
  return "all";
}

/** Waiting and suspended first, then live, then archived. */
export function sortBusinesses(rows: AdminBusiness[]): AdminBusiness[] {
  return rows.toSorted(
    (a, b) => ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status] || a.business_name.localeCompare(b.business_name),
  );
}

export function viewCounts(rows: AdminBusiness[]): Record<BusinessView, number> {
  const out = { all: rows.length, waiting: 0, suspended: 0, live: 0 } as Record<BusinessView, number>;
  for (const b of rows) for (const v of BUSINESS_VIEWS) if (v.id !== "all" && inView(b, v.id)) out[v.id] += 1;
  return out;
}

export function matchesQuery(b: AdminBusiness, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const hay = [b.business_name, b.package_name || ""].join(" ").toLowerCase();
  if (hay.includes(q)) return true;
  if (digits.length >= 3) {
    const nums = [b.sautikit_virtual_number, b.whatsapp_notification_number].map((n) => String(n || "").replace(/\D/g, ""));
    return nums.some((n) => n.includes(digits) || n.includes(digits.replace(/^0/, "254")));
  }
  return false;
}

export function businessTone(status: AdminBusiness["status"]): OpsTone {
  if (status === "active") return "ok";
  if (status === "waiting" || status === "suspended") return "warn";
  return "neutral";
}

export function numberLabel(b: AdminBusiness): string {
  const n = String(b.sautikit_virtual_number || "");
  return !n || n.startsWith("pending:") ? "" : n;
}

export function chargingLabel(b: AdminBusiness): string {
  if (b.billing_enforcement === "hard") return "On";
  if (b.billing_enforcement === "soft") return "Warn only";
  return "Off";
}

export type PaneCall = { id: string; created_at: string; duration_seconds: number | null; primary_intent: string | null; status: string | null };

/** "3 min", "45 s", "—". */
export function callLength(seconds: number | null | undefined): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "—";
  return s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
}

export function intentLabel(intent: string | null | undefined): string {
  const t = String(intent || "").replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Call";
}
