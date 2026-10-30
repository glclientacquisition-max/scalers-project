import type { ReactNode } from "react";
import { StatusMark, type StatusIcon, type StatusTone } from "@/components/ui/StatusMark";

export type OpsTone = "ok" | "info" | "warn" | "danger" | "neutral" | "beta";

/** Tone plus the word. Colour never carries meaning alone. */
export function StatusPill({
  tone,
  icon,
  children,
}: {
  tone: OpsTone;
  icon?: StatusIcon;
  children: ReactNode;
}) {
  return (
    <StatusMark tone={tone as StatusTone} icon={icon} className="h-5 px-2 text-ops-label font-medium">
      {children}
    </StatusMark>
  );
}
