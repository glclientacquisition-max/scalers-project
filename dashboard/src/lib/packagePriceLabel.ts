/** Public price copy. A zero seed is not a free plan. */

export function formatKes(amount: number): string {
  return amount.toLocaleString("en-KE", { maximumFractionDigits: 2 });
}

export function packagePriceLabel(amount: number): string {
  if (!(amount > 0)) return "Not set";
  return `KES ${formatKes(amount)}`;
}

export function assignmentFromBusiness(
  row: { packageId?: string | null; period?: string | null } | null | undefined
): { packageId: string | null; period: "month" | "year" | null } {
  if (!row) return { packageId: null, period: null };
  const period = row.period === "year" || row.period === "month" ? row.period : null;
  return { packageId: row.packageId || null, period };
}
