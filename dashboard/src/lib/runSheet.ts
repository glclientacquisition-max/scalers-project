/** Confirmed visits plus timed open holds. Desk run sheet. Not the confirm queue. */

import {
  canonicalInboxIntent,
  type InboxHold,
  type InboxItem,
  type InboxJob,
} from "@/lib/inboxPurpose";
import {
  eatYmd,
  groupVisitsForWeek,
  visitInstant,
  type CalendarVisit,
} from "@/lib/visitCalendar";

const HOLD_OR_ORDER = new Set(["hold_or_pickup", "hold", "order_enquiry", "order"]);

function jobStatus(job: InboxJob): string {
  return String(job.status || "").toLowerCase();
}

function holdStatus(hold: InboxHold): string {
  return String(hold.status || "").toLowerCase();
}

export function isHoldOrOrder(hold: InboxHold): boolean {
  const key = canonicalInboxIntent(hold.request_type);
  return HOLD_OR_ORDER.has(key);
}

export function isRunSheetJob(job: InboxJob | null | undefined): boolean {
  return Boolean(job && jobStatus(job) === "confirmed");
}

export function isRunSheetHold(
  hold: InboxHold | null | undefined,
  now = new Date()
): boolean {
  if (!hold || holdStatus(hold) !== "open" || !isHoldOrOrder(hold)) return false;
  return Boolean(slotInstantFromHold(hold, now));
}

function slotInstantFromHold(hold: InboxHold, now: Date): Date | null {
  return visitInstant(
    {
      id: hold.id,
      status: hold.status,
      service_name: hold.item || "Hold",
      when_text: hold.when_text,
    },
    now
  );
}

function slotInstantFromJob(job: InboxJob, now: Date): Date | null {
  return visitInstant(
    {
      id: job.id,
      status: job.status,
      service_name: job.service_name,
      when_text: job.when_text,
      window_start: job.window_start,
      window_end: job.window_end,
      address_landmark: job.address_landmark,
      caller_name: job.caller_name,
    },
    now
  );
}

export function isRunSheetItem(item: InboxItem, now = new Date()): boolean {
  if (isRunSheetJob(item.job)) return true;
  if (isRunSheetHold(item.hold, now)) return true;
  return false;
}

export function runSheetItems(items: InboxItem[], now = new Date()): InboxItem[] {
  return (items || []).filter((item) => isRunSheetItem(item, now));
}

export function runSheetInstant(item: InboxItem, now = new Date()): Date | null {
  if (item.job && isRunSheetJob(item.job)) return slotInstantFromJob(item.job, now);
  if (item.hold && isRunSheetHold(item.hold, now)) {
    return slotInstantFromHold(item.hold, now);
  }
  return null;
}

function asCalendarVisit(item: InboxItem): CalendarVisit | null {
  if (item.job && isRunSheetJob(item.job)) {
    return {
      id: item.job.id,
      status: item.job.status,
      service_name: item.job.service_name,
      when_text: item.job.when_text,
      window_start: item.job.window_start,
      window_end: item.job.window_end,
      address_landmark: item.job.address_landmark,
      caller_name: item.callerName,
    };
  }
  if (item.hold && holdStatus(item.hold) === "open" && isHoldOrOrder(item.hold)) {
    return {
      id: item.hold.id,
      status: "confirmed",
      service_name: item.hold.item || "Hold",
      when_text: item.hold.when_text,
      caller_name: item.callerName,
    };
  }
  return null;
}

export function groupRunSheetForWeek(
  items: InboxItem[],
  monday: string,
  now = new Date()
) {
  const visits = runSheetItems(items, now)
    .map(asCalendarVisit)
    .filter((row): row is CalendarVisit => Boolean(row));
  return groupVisitsForWeek(visits, monday, now);
}

export function runSheetForDay(
  items: InboxItem[],
  ymd: string,
  now = new Date()
): InboxItem[] {
  const rows = runSheetItems(items, now).filter((item) => {
    const instant = runSheetInstant(item, now);
    return instant ? eatYmd(instant) === ymd : false;
  });
  rows.sort((a, b) => {
    const ta = runSheetInstant(a, now)?.getTime() || 0;
    const tb = runSheetInstant(b, now)?.getTime() || 0;
    return ta - tb;
  });
  return rows;
}

export function formatSlotClock(item: InboxItem, now = new Date()): string {
  const text = String(item.job?.when_text || item.hold?.when_text || "").trim();
  if (text) return text;
  const instant = runSheetInstant(item, now);
  if (!instant) return "Time TBD";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
