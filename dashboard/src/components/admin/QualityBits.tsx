import type { ReactNode } from "react";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import {
  checkLabel,
  failingChecks,
  formatDelta,
  formatScore,
  LATENCY_BUDGET_MS,
  type VoiceCheckCounts,
} from "@/lib/adminQualityModel";

/** Fixed scale so the 1200 ms budget tick stays in the same place on every turn. */
const LATENCY_SCALE_MS = LATENCY_BUDGET_MS * 2;

export function Unlogged({ children = "Not logged" }: { children?: ReactNode }) {
  return <span className="text-meta text-ink-3">{children}</span>;
}

/** Score up is better. Check counts pass `lowerIsBetter` because a drop is better. */
export function DeltaMark({ delta, lowerIsBetter = false }: { delta: number | null; lowerIsBetter?: boolean }) {
  const text = formatDelta(delta);
  if (delta == null || !Number.isFinite(delta) || delta === 0) {
    return <span className="tabular-nums text-ink-3">{text}</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return <span className={cx("tabular-nums", improved ? "text-ok" : "text-attention")}>{text}</span>;
}

const callWhen = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Nairobi",
});

export function formatCallWhen(iso: string | null): string {
  if (!iso) return "Not logged";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not logged";
  return callWhen.format(date);
}

export function QualitySpark({ points, dropping = false }: { points: number[]; dropping?: boolean }) {
  if (points.length < 3) {
    return <span className="block w-16 text-caption leading-tight text-ink-3">Too few calls</span>;
  }
  const width = 64;
  const height = 20;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend ${points.map((point) => formatScore(point)).join(", ")}`}
      className={dropping ? "text-attention" : "text-ink-2"}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FailChips({ checks }: { checks: VoiceCheckCounts }) {
  const names = failingChecks(checks);
  if (names.length === 0) return <Unlogged>No failures</Unlogged>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex min-h-6 items-center rounded-md bg-attention-tonal px-1.5 text-caption font-medium text-attention"
        >
          {checkLabel(name)}
        </span>
      ))}
    </span>
  );
}

/** Word plus reason. The attention tone is never the only signal. */
export function DroppingMark({ dropping, reason }: { dropping: boolean; reason: string }) {
  if (!dropping) return <span className="text-meta text-ink-3">Steady</span>;
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
      <Stamp tone="attention">Dropping</Stamp>
      {reason ? <span className="max-w-[14rem] text-caption text-attention">{reason}</span> : null}
    </span>
  );
}

export function LatencyBar({ ms }: { ms: number | null }) {
  if (ms == null || !Number.isFinite(ms)) {
    return <Unlogged />;
  }
  const shown = Math.round(ms).toLocaleString("en-KE");
  const valuePct = Math.min(100, (Math.max(0, ms) / LATENCY_SCALE_MS) * 100);
  const budgetPct = (LATENCY_BUDGET_MS / LATENCY_SCALE_MS) * 100;
  const okPct = Math.min(valuePct, budgetPct);
  const overPct = Math.max(0, valuePct - budgetPct);
  const over = ms > LATENCY_BUDGET_MS;
  return (
    <div>
      <div
        className="relative h-2 rounded-full bg-surface-2"
        role="img"
        aria-label={over ? `${shown} ms, past the 1200 ms budget` : `${shown} ms, under the 1200 ms budget`}
      >
        {okPct > 0 ? (
          <div
            className={cx("absolute inset-y-0 start-0 bg-ok", overPct > 0 ? "rounded-s-full" : "rounded-full")}
            style={{ width: `${okPct}%` }}
          />
        ) : null}
        {overPct > 0 ? (
          <div
            className="absolute inset-y-0 rounded-e-full bg-attention"
            style={{ left: `${budgetPct}%`, width: `${overPct}%` }}
          />
        ) : null}
        <div className="absolute inset-y-0 w-px bg-ink" style={{ left: `${budgetPct}%` }} />
      </div>
      <div className="relative mt-1 h-4">
        <span
          className="absolute -translate-x-1/2 text-caption tabular-nums text-ink-3"
          style={{ left: `${budgetPct}%` }}
        >
          1200 ms
        </span>
      </div>
      <p className="text-caption tabular-nums text-ink-2">
        {over ? `${shown} ms, past the 1200 ms budget` : `${shown} ms`}
      </p>
    </div>
  );
}

export function StruckDrop({ before, dropped }: { before: string; dropped: string }) {
  if (!dropped) return <span>{before}</span>;
  const index = before.indexOf(dropped);
  if (index < 0) {
    return (
      <>
        <span>{before}</span>{" "}
        <span className="text-ink-3 line-through">{dropped}</span>
      </>
    );
  }
  return (
    <>
      <span>{before.slice(0, index)}</span>
      <span className="text-ink-3 line-through">{dropped}</span>
      <span>{before.slice(index + dropped.length)}</span>
    </>
  );
}

export function TurnFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 md:grid-cols-[8.5rem_minmax(0,1fr)] md:items-baseline md:gap-3">
      <dt className="text-caption text-ink-3">{label}</dt>
      <dd className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
