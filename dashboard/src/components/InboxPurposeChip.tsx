import type { InboxPurpose } from "@/lib/inboxPurpose";
import { purposeLabel } from "@/lib/inboxPurpose";

const TONE: Record<InboxPurpose, string> = {
  job: "bg-[#EAF6FF] text-[#005ccc] ring-[#0096FF]/20",
  hold: "bg-ok-soft text-ok ring-ok/15",
  human: "bg-warn-soft text-warn ring-warn/20",
  missed: "bg-surface-muted text-ink ring-line",
  answered: "bg-white text-ink-soft ring-line",
};

export function InboxPurposeChip({ purpose }: { purpose: InboxPurpose }) {
  return (
    <span
      className={[
        "inline-flex min-h-7 items-center rounded-md px-2 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1",
        TONE[purpose],
      ].join(" ")}
    >
      {purposeLabel(purpose)}
    </span>
  );
}
