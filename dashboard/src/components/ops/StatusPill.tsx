import type { ReactNode } from "react";
import { StatusMark, type StatusIcon, type StatusTone } from "@/components/ui/StatusMark";
import { isDefaultStatus } from "@/lib/statusQuiet";

export type OpsTone = "ok" | "info" | "warn" | "danger" | "neutral" | "beta";

/** Tone plus the word. Colour never carries meaning alone. Live and Active stay quiet. */
export function StatusPill({
  tone,
  icon,
  children,
}: {
  tone: OpsTone;
  icon?: StatusIcon;
  children: ReactNode;
}) {
  if (typeof children === "string" && isDefaultStatus(children)) return null;
  return (
    <StatusMark tone={tone as StatusTone} icon={icon} className="h-5 px-2 text-ops-label font-medium">
      {children}
    </StatusMark>
  );
}
