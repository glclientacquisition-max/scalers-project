import type { InboxPurpose } from "@/lib/inboxPurpose";
import { purposeLabel } from "@/lib/inboxPurpose";
import { Stamp, type StampTone } from "@/components/ui/Stamp";

function purposeStampTone(purpose: InboxPurpose): StampTone {
  if (purpose === "live") return "live";
  if (purpose === "human" || purpose === "missed") return "attention";
  if (purpose === "job" || purpose === "hold") return "ok";
  return "neutral";
}

export function InboxPurposeChip({
  purpose,
  label,
}: {
  purpose: InboxPurpose;
  label?: string;
}) {
  return <Stamp tone={purposeStampTone(purpose)}>{label || purposeLabel(purpose)}</Stamp>;
}
