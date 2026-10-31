"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

export type SparkPoint = { label: string; value: number };
export type SparkUnit = "calls" | "ksh";

function formatPoint(unit: SparkUnit, value: number): string {
  if (unit === "ksh") {
    const shillings = Math.round(value) / 100;
    const digits = Number.isInteger(shillings) ? 0 : 2;
    return `KSh ${shillings.toLocaleString("en-KE", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  }
  return `${value.toLocaleString("en-KE")} calls`;
}

/**
 * One accent line with a point value on hover or press.
 * Stroke animation stays off. The card fade uses the motion tokens.
 * `unit` is a string so a server page can pass it to this client chart.
 */
export function MetricSparkline({
  points,
  unit,
}: {
  points: SparkPoint[];
  unit: SparkUnit;
}) {
  if (points.length < 2) return null;
  return (
    <div className="mt-2 h-14 w-full" aria-label="Trend">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <Tooltip
            cursor={{ stroke: "var(--hairline)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as SparkPoint | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-hairline bg-surface px-2 py-1 text-meta tabular-nums text-ink">
                  {row.label} · {formatPoint(unit, row.value)}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "var(--accent)", stroke: "var(--surface)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
