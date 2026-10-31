import type { ReactNode } from "react";
import Link from "next/link";
import { formatDelta } from "@/lib/ops/format";
import { Sparkline } from "./Sparkline";

export function KpiTile({
  label,
  value,
  delta,
  trend,
  period,
  asOf,
  href,
  compare,
  state = "ready",
  emptyTitle,
  errorTitle,
  onRetry,
}: {
  label: string;
  value?: ReactNode;
  /** Only pass a delta computed from a previous period that exists. */
  delta?: number;
  trend?: number[];
  period?: string;
  asOf?: string;
  href?: string;
  /** Sentence from real earlier data. Omitted when that period has none. */
  compare?: string | null;
  state?: "ready" | "empty" | "error";
  emptyTitle?: string;
  errorTitle?: string;
  onRetry?: () => void;
}) {
  const body = (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-surface p-ops-3">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-ops-label text-ink-2">{label}</span>
        {period ? <span className="shrink-0 text-ops-caption text-ink-2">{period}</span> : null}
      </span>
      {state === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-1">
          <p className="text-ops-body text-attention">{errorTitle || "Could not load this."}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="min-h-11 text-ops-label font-medium text-accent underline-offset-2 hover:underline">Retry</button>
          ) : null}
        </div>
      ) : state === "empty" ? (
        <p className="text-ops-body text-ink-2">{emptyTitle || "Nothing in this period."}</p>
      ) : (
        <span className="ops-num truncate text-ops-title font-semibold text-ink sm:text-ops-kpi">{value}</span>
      )}
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {compare ? <span className="text-ops-caption text-ink-2">{compare}</span> : null}
        {delta === undefined ? null : (
          <span className="ops-num whitespace-nowrap text-ops-caption" style={{ color: delta < 0 ? "var(--ops-status-danger-fg)" : "var(--ops-status-ok-fg)" }}>
            {formatDelta(delta)} <span className="text-ink-2">7d</span>
          </span>
        )}
        {trend && trend.length >= 2 ? <Sparkline points={trend} label={label} /> : null}
      </span>
      {asOf ? <span className="text-ops-caption text-ink-3">As of {asOf}</span> : null}
    </div>
  );
  if (!href || state !== "ready") return body;
  return (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {body}
    </Link>
  );
}
