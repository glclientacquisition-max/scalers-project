/** Ops number formatting. Pure, shared by components and tests. Spec: OPS.md §4. */

const group = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 });

/** Integer KSh in. "KSh 0", never blank. Negatives use a true minus before the currency. */
export function formatKsh(value: number | null | undefined): string {
  const n = Number.isFinite(value) ? Math.round(value as number) : 0;
  const body = `KSh ${group.format(Math.abs(n))}`;
  return n < 0 ? `\u2212${body}` : body;
}

/** Tile-sized money: KSh 1.2M. Exact value goes in the title attribute. */
export function formatKshCompact(value: number | null | undefined): string {
  const n = Number.isFinite(value) ? Math.round(value as number) : 0;
  if (Math.abs(n) < 10_000) return formatKsh(n);
  const body = `KSh ${compact.format(Math.abs(n))}`;
  return n < 0 ? `\u2212${body}` : body;
}

export function formatCount(value: number | null | undefined): string {
  return group.format(Number.isFinite(value) ? Math.round(value as number) : 0);
}

/** Signed percent change, one decimal: "+4.2%", "−12.0%", "0.0%". */
export function formatDelta(pct: number): string {
  if (!Number.isFinite(pct) || pct === 0) return "0.0%";
  return `${pct > 0 ? "+" : "\u2212"}${Math.abs(pct).toFixed(1)}%`;
}

/** Kit page is staging only. Anything other than exactly "staging" hides it. */
export function opsKitEnabled(env: string | undefined): boolean {
  return (env || "").trim().toLowerCase() === "staging";
}
