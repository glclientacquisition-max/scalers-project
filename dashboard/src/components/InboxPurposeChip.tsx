import type { InboxPurpose } from "@/lib/inboxPurpose";
import { purposeLabel } from "@/lib/inboxPurpose";
import { Stamp, type StampTone } from "@/components/ui/Stamp";

/**
 * Glance tone for a purpose stamp. Three tones: attention, ok, neutral.
 * Live uses ok. A live row may still pass Stamp `live` for the ping.
 */
export function inboxStampTone(
  purpose: InboxPurpose,
  label?: string
): Exclude<StampTone, "live"> {
  const text = (label || "").toLowerCase();
  if (purpose === "live" || text === "live") return "ok";
  if (text.includes("done")) return "ok";
  if (
    purpose === "human" ||
    purpose === "missed" ||
    text.startsWith("confirm") ||
    text.includes("not booked") ||
    text.includes("not saved") ||
    text.includes("human asked")
  ) {
    return "attention";
  }
  if (purpose === "hold") return "ok";
  return "neutral";
}

export function InboxPurposeChip({
  purpose,
  label,
}: {
  purpose: InboxPurpose;
  label?: string;
}) {
  const text = label || purposeLabel(purpose);
  return <Stamp tone={inboxStampTone(purpose, text)}>{text}</Stamp>;
}
