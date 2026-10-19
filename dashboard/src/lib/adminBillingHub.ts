import type { AdminBillingRow, AdminBillingStatus } from "@/lib/adminBilling";

export type BillingAttentionKind = "all" | "no_package" | "low_minutes" | "exhausted";

const STATUS_RANK: Record<AdminBillingStatus, number> = {
  exhausted: 0,
  low_minutes: 1,
  ok: 2,
  charging: 3,
  archived: 4,
};

export function billingStatusRank(status: AdminBillingStatus): number {
  return STATUS_RANK[status] ?? 9;
}

export function sortBillingQueue(rows: AdminBillingRow[]): AdminBillingRow[] {
  return [...rows].sort((a, b) => {
    const rank = billingStatusRank(a.status) - billingStatusRank(b.status);
    if (rank !== 0) return rank;
    if (a.minutesRemaining !== b.minutesRemaining) {
      return a.minutesRemaining - b.minutesRemaining;
    }
    return a.business_name.localeCompare(b.business_name, "en-KE");
  });
}

export function filterAttentionKind(rows: AdminBillingRow[], kind: BillingAttentionKind): AdminBillingRow[] {
  if (kind === "all") return rows;
  if (kind === "no_package") return rows.filter((r) => !r.packageName);
  if (kind === "low_minutes") return rows.filter((r) => r.status === "low_minutes");
  return rows.filter((r) => r.status === "exhausted");
}

export function attentionRows(rows: AdminBillingRow[]): AdminBillingRow[] {
  return rows.filter(
    (r) =>
      r.status !== "archived" &&
      (!r.packageName || r.status === "low_minutes" || r.status === "exhausted"),
  );
}

export function stampToneForBillingStatus(status: AdminBillingStatus): "attention" | "ok" | "brand" | "neutral" {
  if (status === "exhausted" || status === "low_minutes") return "attention";
  if (status === "charging") return "brand";
  if (status === "archived") return "neutral";
  return "ok";
}

export function rowWhenLabel(r: AdminBillingRow): string {
  if (r.status === "archived") return "Archived";
  if (!r.packageName) return "No package";
  if (r.minutesIncluded <= 0) return "No cap";
  if (r.minutesRemaining <= 0) return "0 left";
  return `${r.minutesRemaining} left`;
}

export function rowPreviewLine(r: AdminBillingRow, modeLabel: (m: AdminBillingRow["billing_enforcement"]) => string): string {
  return [
    r.sautikit_virtual_number ? r.sautikit_virtual_number.replace(/\s+/g, " ") : "No number",
    r.packageName || "Unassigned",
    modeLabel(r.billing_enforcement),
  ].join(" · ");
}

export function hubTotals(rows: AdminBillingRow[]) {
  const active = rows.filter((r) => r.status !== "archived");
  return {
    activeCount: active.length,
    needsCount: attentionRows(rows).length,
    onDemandCount: active.filter((r) => r.on_demand_usage_enabled).length,
    minutesUsed: active.reduce((sum, r) => sum + r.minutesUsed, 0),
    minutesIncluded: active.reduce((sum, r) => sum + r.minutesIncluded, 0),
  };
}
