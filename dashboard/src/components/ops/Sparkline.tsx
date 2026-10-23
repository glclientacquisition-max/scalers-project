/** Server SVG. Fixed height so nothing jumps. */
export function Sparkline({ points, label, height = 28, width = 96 }: { points: number[]; label: string; height?: number; width?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg role="img" aria-label={`${label}: ${points[0]} to ${points[points.length - 1]}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <path d={d} fill="none" strokeWidth={1.5} stroke={up ? "var(--ops-chart-up)" : "var(--ops-chart-down)"} />
    </svg>
  );
}
