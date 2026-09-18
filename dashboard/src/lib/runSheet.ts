/** Visits List, Today, and Week. One book: requested and confirmed visits. */

import type { InboxItem, InboxJob } from "@/lib/inboxPurpose";
import {
  eatYmd,
  groupVisitsForWeek,
  visitInstant,
  type CalendarVisit,
} from "@/lib/visitCalendar";

function jobStatus(job: InboxJob): string {
  return String(job.status || "").toLowerCase();
}

export function isVisitBoardJob(job: InboxJob | null | undefined): boolean {
  if (!job) return false;
  const status = jobStatus(job);
  return status === "requested" || status === "confirmed";
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

export function visitBoardItems(items: InboxItem[]): InboxItem[] {
  return (items || []).filter((item) => isVisitBoardJob(item.job));
}

export function visitBoardInstant(item: InboxItem, now = new Date()): Date | null {
  if (item.job && isVisitBoardJob(item.job)) return slotInstantFromJob(item.job, now);
  return null;
}

function asCalendarVisit(item: InboxItem): CalendarVisit | null {
  if (!item.job || !isVisitBoardJob(item.job)) return null;
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

export function groupVisitBoardForWeek(
  items: InboxItem[],
  monday: string,
  now = new Date()
) {
  const visits = visitBoardItems(items)
    .map(asCalendarVisit)
    .filter((row): row is CalendarVisit => Boolean(row));
  return groupVisitsForWeek(visits, monday, now);
}

export function visitBoardForDay(
  items: InboxItem[],
  ymd: string,
  now = new Date()
): InboxItem[] {
  const rows = visitBoardItems(items).filter((item) => {
    const instant = visitBoardInstant(item, now);
    return instant ? eatYmd(instant) === ymd : false;
  });
  rows.sort((a, b) => {
    const ta = visitBoardInstant(a, now)?.getTime() || 0;
    const tb = visitBoardInstant(b, now)?.getTime() || 0;
    return ta - tb;
  });
  return rows;
}

export function formatSlotClock(item: InboxItem, now = new Date()): string {
  const text = String(item.job?.when_text || "").trim();
  if (text) return text;
  const instant = visitBoardInstant(item, now);
  if (!instant) return "Time TBD";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
