import { cx } from "@/lib/cx";
import { formatKsh, formatKshCompact } from "@/lib/ops/format";

/** Integer KSh. Compact form keeps the exact value in the title. */
export function Money({ value, compact = false, className }: { value: number | null | undefined; compact?: boolean; className?: string }) {
  const exact = formatKsh(value);
  return (
    <span className={cx("ops-num whitespace-nowrap", (value ?? 0) < 0 && "text-[color:var(--ops-status-danger-fg)]", className)} title={compact ? exact : undefined}>
      {compact ? formatKshCompact(value) : exact}
    </span>
  );
}
