import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type StampTone = "neutral" | "attention" | "ok" | "live";

const dot: Record<StampTone, string> = {
  neutral: "bg-ink-3",
  attention: "bg-attention",
  ok: "bg-ok",
  live: "bg-ok",
};

const text: Record<StampTone, string> = {
  neutral: "text-ink-2",
  attention: "text-attention",
  ok: "text-ok",
  live: "text-ok",
};

/**
 * Glance state on a row: one dot, one or two words. Not a chip.
 * `live` adds the desk ping. Three tones in a viewport at most.
 */
export function Stamp({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StampTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5 text-meta font-medium", text[tone], className)}>
      <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
        {tone === "live" ? (
          <span className={cx("desk-live-ping absolute inline-flex h-full w-full rounded-full opacity-60", dot.live)} />
        ) : null}
        <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot[tone])} />
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}
