/** Holds List is open holds. Work is timed pickups only. Anytime stays on List. */

import type { InboxItem, InboxHold } from "@/lib/inboxPurpose";
import { itemIsArchived } from "@/lib/inboxPurpose";
import { eatYmd, visitInstant } from "@/lib/visitCalendar";

export function isHoldBoardItem(item: InboxItem | null | undefined): boolean {
  if (!item?.hold || itemIsArchived(item)) return false;
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
    window_start: hold.window_start,
    window_end: hold.window_end,
    caller_name: callerName,
  };
}

export function holdBoardInstant(item: InboxItem, now = new Date()): Date | null {
  if (!item.hold || !isHoldBoardItem(item)) return null;
  return visitInstant(asVisit(item.hold, item.callerName), now);
}

export function holdWorkItems(items: InboxItem[], now = new Date()): InboxItem[] {
  return holdBoardItems(items).filter((item) => Boolean(holdBoardInstant(item, now)));
}

export function holdBoardForDay(
  items: InboxItem[],
  ymd: string,
  now = new Date()
): InboxItem[] {
  const rows = holdWorkItems(items, now).filter((item) => {
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

export function isHoldListLeftover(item: InboxItem, now = new Date()): boolean {
  const instant = holdBoardInstant(item, now);
  if (!instant) return false;
  return eatYmd(instant) < eatYmd(now);
}

export function orderHoldList(items: InboxItem[], now = new Date()): InboxItem[] {
  return [...(items || [])].sort((a, b) => {
    const aLeft = isHoldListLeftover(a, now);
    const bLeft = isHoldListLeftover(b, now);
    if (aLeft && !bLeft) return -1;
    if (!aLeft && bLeft) return 1;
    if (aLeft && bLeft) {
      const ta = holdBoardInstant(a, now)?.getTime() || 0;
      const tb = holdBoardInstant(b, now)?.getTime() || 0;
      if (ta !== tb) return ta - tb;
    }
    return 0;
  });
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
