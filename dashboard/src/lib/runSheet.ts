/** Visits List, Today, and Week. One book: requested and confirmed visits. */

import type { InboxItem, InboxJob } from "@/lib/inboxPurpose";
import { eatYmd, visitInstant, weekDays } from "@/lib/visitCalendar";

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

function sortBySlot(items: InboxItem[], now: Date): InboxItem[] {
  const rows = [...items];
  rows.sort((a, b) => {
    const ta = visitBoardInstant(a, now)?.getTime() || 0;
    const tb = visitBoardInstant(b, now)?.getTime() || 0;
    return ta - tb;
  });
  return rows;
}

export function visitBoardForDay(
  items: InboxItem[],
  ymd: string,
  now = new Date()
): InboxItem[] {
  return sortBySlot(
    visitBoardItems(items).filter((item) => {
      const instant = visitBoardInstant(item, now);
      return instant ? eatYmd(instant) === ymd : false;
    }),
    now
  );
}

export function visitBoardForWeek(
  items: InboxItem[],
  monday: string,
  now = new Date()
): InboxItem[] {
  const keys = new Set(weekDays(monday, now).map((day) => day.key));
  return sortBySlot(
    visitBoardItems(items).filter((item) => {
      const instant = visitBoardInstant(item, now);
      return instant ? keys.has(eatYmd(instant)) : false;
    }),
    now
  );
}
