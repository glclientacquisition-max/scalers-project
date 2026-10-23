import type { ReactNode } from "react";
import { formatDelta } from "@/lib/ops/format";
import { Sparkline } from "./Sparkline";

export function KpiTile({ label, value, delta, trend }: { label: string; value: ReactNode; delta?: number; trend?: number[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-surface p-ops-3">
      <span className="truncate text-ops-label text-ink-2">{label}</span>
      <span className="ops-num truncate text-ops-title text-ink sm:text-ops-kpi">{value}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {delta === undefined ? <span /> : (
          <span className="ops-num whitespace-nowrap text-ops-caption" style={{ color: delta < 0 ? "var(--ops-status-danger-fg)" : "var(--ops-status-ok-fg)" }}>
            {formatDelta(delta)} <span className="text-ink-2">7d</span>
          </span>
        )}
        {trend ? <Sparkline points={trend} label={label} /> : null}
      </span>
    </div>
  );
}
