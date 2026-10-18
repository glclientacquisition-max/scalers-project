import { cx } from "@/lib/cx";
import { usedPercent, type MeterTone } from "@/lib/planEntry";

/** Share used, filled from the start. Warn and full turn the fill to the warning colour. */
export function UsageBar({
  used,
  included,
  tone,
  label,
  thin = false,
  className,
}: {
  used: number;
  included: number;
  tone: MeterTone;
  label: string;
  thin?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx("overflow-hidden rounded-full bg-surface-2", thin ? "h-1.5" : "h-2", className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, included)}
      aria-valuenow={Math.min(Math.max(0, used), Math.max(0, included))}
    >
      <div
        className={cx("h-full rounded-full", tone === "ok" ? "bg-accent" : "bg-warn")}
        style={{ width: `${usedPercent(used, included)}%` }}
      />
    </div>
  );
}

export function toneText(tone: MeterTone): string {
  return tone === "ok" ? "text-ink" : "text-warn";
}
