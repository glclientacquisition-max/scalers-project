import type { ReactNode } from "react";
import { StatusMark, type StatusIcon, type StatusTone } from "@/components/ui/StatusMark";

export type StampTone = "neutral" | "attention" | "ok" | "live";

const tone: Record<StampTone, StatusTone> = {
  neutral: "neutral",
  attention: "warn",
  ok: "ok",
  live: "ok",
};

const icon: Record<StampTone, StatusIcon> = {
  neutral: "ring",
  attention: "tri",
  ok: "check",
  live: "check",
};

/**
 * Glance state on a row: icon, one or two words, one tone.
 * `live` is the same check as ok. The pill itself does not pulse.
 */
export function Stamp({
  tone: stampTone = "neutral",
  children,
  className,
  wrap = false,
}: {
  tone?: StampTone;
  children: ReactNode;
  className?: string;
  /** Show the full label on a narrow row. */
  wrap?: boolean;
}) {
  return (
    <StatusMark tone={tone[stampTone]} icon={icon[stampTone]} className={className} wrap={wrap}>
      {children}
    </StatusMark>
  );
}
