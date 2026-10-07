import type { ReactNode } from "react";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import {
  checkLabel,
  failingChecks,
  formatScore,
  LATENCY_BUDGET_MS,
  type VoiceCheckCounts,
} from "@/lib/adminQualityModel";

const callWhen = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Nairobi",
});

export function formatCallWhen(iso: string | null): string {
  if (!iso) return "None";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "None";
  return callWhen.format(date);
}

export function QualitySpark({ points, dropping = false }: { points: number[]; dropping?: boolean }) {
  if (points.length === 0) return <span className="text-meta text-ink-3">None</span>;
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
  if (names.length === 0) return <span className="text-meta text-ink-3">None</span>;
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
    return <span className="text-meta text-ink-3">No latency</span>;
  }
  const scale = Math.max(ms, LATENCY_BUDGET_MS);
  const bar = Math.min(100, (ms / scale) * 100);
  const line = (LATENCY_BUDGET_MS / scale) * 100;
  const over = ms > LATENCY_BUDGET_MS;
  const shown = Math.round(ms).toLocaleString("en-KE");
  return (
    <div>
      <div
        className="relative h-2 rounded-full bg-surface-2"
        role="img"
        aria-label={over ? `${shown} ms, past the 1200 ms budget` : `${shown} ms of 1200 ms`}
      >
        <div
          className={cx("absolute inset-y-0 start-0 rounded-full", over ? "bg-attention" : "bg-ink")}
          style={{ width: `${bar}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${line}%` }} />
      </div>
      <p className="mt-1 text-caption tabular-nums text-ink-2">
        {over ? `${shown} ms, past the 1200 ms budget` : `${shown} ms of 1200 ms`}
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
