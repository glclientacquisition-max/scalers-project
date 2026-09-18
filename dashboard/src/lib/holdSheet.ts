/** Holds List and Work. One book: open holds. Anytime stays on List. */

import type { InboxItem, InboxHold } from "@/lib/inboxPurpose";
import { eatYmd, visitInstant } from "@/lib/visitCalendar";

export function isHoldBoardItem(item: InboxItem | null | undefined): boolean {
  if (!item?.hold) return false;
  return String(item.hold.status || "").toLowerCase() === "open";
}

export function holdBoardItems(items: InboxItem[]): InboxItem[] {
  return (items || []).filter(isHoldBoardItem);
}

function asVisit(hold: InboxHold, callerName: string | null) {
  return {
    id: hold.id,
    status: hold.status,
    service_name: hold.item || "",
    when_text: hold.when_text,
    caller_name: callerName,
  };
}

export function holdBoardInstant(item: InboxItem, now = new Date()): Date | null {
  if (!item.hold || !isHoldBoardItem(item)) return null;
  return visitInstant(asVisit(item.hold, item.callerName), now);
}

export function holdBoardForDay(
  items: InboxItem[],
  ymd: string,
  now = new Date()
): InboxItem[] {
  const rows = holdBoardItems(items).filter((item) => {
    const instant = holdBoardInstant(item, now);
    return instant ? eatYmd(instant) === ymd : false;
  });
  rows.sort((a, b) => {
    const ta = holdBoardInstant(a, now)?.getTime() || 0;
    const tb = holdBoardInstant(b, now)?.getTime() || 0;
    return ta - tb;
  });
  return rows;
}

export function formatHoldClock(item: InboxItem, now = new Date()): string {
  const text = String(item.hold?.when_text || "").trim();
  if (text) return text;
  const instant = holdBoardInstant(item, now);
  if (!instant) return "Anytime";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
