import type { AdminBusiness } from "@/lib/admin";
import type { OpsTone } from "@/components/ops/StatusPill";

/** Problem views first. "Live" is the default when nothing waits for a number. */
export const BUSINESS_VIEWS = [
  { id: "waiting", label: "Waiting for a number" },
  { id: "suspended", label: "Suspended" },
  { id: "live", label: "Live" },
  { id: "archived", label: "Archived" },
] as const;
export type BusinessView = (typeof BUSINESS_VIEWS)[number]["id"];

export function inView(b: AdminBusiness, view: BusinessView): boolean {
  if (view === "live") return b.status === "active";
  return b.status === view;
}

export function defaultView(rows: AdminBusiness[]): BusinessView {
  return rows.some((b) => b.status === "waiting") ? "waiting" : "live";
}

export function viewCounts(rows: AdminBusiness[]): Record<BusinessView, number> {
  const out = { waiting: 0, suspended: 0, live: 0, archived: 0 } as Record<BusinessView, number>;
  for (const b of rows) for (const v of BUSINESS_VIEWS) if (inView(b, v.id)) out[v.id] += 1;
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
  return !n || n.startsWith("pending:") ? "None yet" : n;
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
