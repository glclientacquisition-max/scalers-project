import { StatusMark } from "@/components/ui/StatusMark";
import { minutesMeterFill, minutesMeterMark, minutesMeterState, minutesRingFill, type MinutesMeterInput } from "@/lib/minutesMeter";

/**
 * Allowance as length. Ring on Desk, bar in Admin.
 * The bar uses scaleX (transform only). It does not loop.
 */
export function MinutesMeter({
  input,
  shape,
  showChip = true,
}: {
  input: MinutesMeterInput;
  shape: "bar" | "ring";
  /** Desk Overview draws the chip under the minutes figure, where the half card has width. */
  showChip?: boolean;
}) {
  const state = minutesMeterState(input);
  const mark = minutesMeterMark(input);
  if (state === "none" || !mark) {
    return <p className="text-body text-ink-2">No package</p>;
  }
  const fill = shape === "ring" ? minutesRingFill(input) : (state === "usedup" || state === "limit" ? 0 : minutesMeterFill(input));
  const { word: label, tone } = mark;
  const color = `var(--status-${tone}-fg)`;

  const track = shape === "ring" ? (
    <Ring fill={fill} color={color} label={label} />
  ) : (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
      <div
        className="h-full w-full origin-left rounded-full motion-reduce:transition-none"
        style={{ background: color, transform: `scaleX(${fill})`, transition: "transform 200ms var(--ease-out)" }}
      />
      {state === "over" ? (
        <span className="status-hatch absolute inset-y-0 end-0 w-1/5 border-s border-warn" aria-hidden="true" />
      ) : null}
    </div>
  );

  return (
    <div className={shape === "ring" ? "flex items-center" : "flex flex-col gap-2"}>
      {track}
      {showChip ? <StatusMark tone={tone} wrap>{label}</StatusMark> : null}
    </div>
  );
}

function Ring({ fill, color, label }: { fill: number; color: string; label: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = `${(c * fill).toFixed(1)} ${c.toFixed(1)}`;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={label} className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
      {fill > 0 ? (
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={dash}
          transform="rotate(-90 28 28)"
        />
      ) : null}
    </svg>
  );
}
