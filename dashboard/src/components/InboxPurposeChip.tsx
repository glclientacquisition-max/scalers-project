import type { InboxPurpose } from "@/lib/inboxPurpose";
import { purposeLabel } from "@/lib/inboxPurpose";

const TONE: Record<InboxPurpose, string> = {
  job: "bg-[#EAF6FF] text-[#005ccc] ring-[#0096FF]/20",
  hold: "bg-ok-soft text-ok ring-ok/15",
  human: "bg-warn-soft text-warn ring-warn/20",
  missed: "bg-surface-muted text-ink ring-line",
  answered: "bg-white text-ink-soft ring-line",
};

export function InboxPurposeChip({
  purpose,
  label,
}: {
  purpose: InboxPurpose;
  label?: string;
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 max-w-[11rem] items-center truncate rounded-md px-2 text-[11px] font-semibold tracking-wide ring-1",
        TONE[purpose],
      ].join(" ")}
    >
      {label || purposeLabel(purpose)}
    </span>
  );
}
