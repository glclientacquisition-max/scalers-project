import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import type { InboxItem } from "@/lib/inboxPurpose";
import { nicheCopy } from "@/lib/inboxNiche";
import {
  groupVisitsForWeek,
  weekHeading,
  type CalendarVisit,
} from "@/lib/visitCalendar";

function jobToVisit(item: InboxItem): CalendarVisit | null {
  if (!item.job) return null;
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

export function VisitWeekCalendar({
  items,
  monday,
  prevHref,
  nextHref,
  listHref,
  vertical,
}: {
  items: InboxItem[];
  monday: string;
  prevHref: string;
  nextHref: string;
  listHref: string;
  businessName: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  const byId = new Map(items.filter((item) => item.job).map((item) => [item.job!.id, item]));
  const visits = items.map(jobToVisit).filter((row): row is CalendarVisit => Boolean(row));
  const { days, byDay, unscheduled } = groupVisitsForWeek(visits, monday);
  const heading = weekHeading(monday);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-sm font-semibold text-ink">{heading}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={prevHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Prev
          </Link>
          <Link
            href={nextHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Next
          </Link>
          <Link
            href={listHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent-deep hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
          >
            List
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-7">
        {days.map((day) => {
          const rows = byDay[day.key] || [];
          return (
            <section
              key={day.key}
              className={[
                "min-h-[11rem] bg-surface p-3",
                day.isToday ? "bg-accent/[0.06]" : "",
              ].join(" ")}
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {day.weekdayShort} {day.dayNum}
              </h2>
              <ul className="mt-2 space-y-2">
                {rows.length === 0 ? (
                  <li className="text-xs text-ink-soft">None</li>
                ) : (
                  rows.map((visit) => {
                    const item = byId.get(visit.id);
                    if (!item?.job) return null;
                    return (
                      <li
                        key={visit.id}
                        className="relative border-t border-line/70 pt-2 first:border-t-0 first:pt-0"
                      >
                        <DeskRowHit
                          href={item.callId ? `/calls/${item.callId}?from=job` : null}
                          label="Conversation"
                        />
                        <p className={`${deskRowMutedClass} text-sm font-semibold text-ink`}>
                          {visit.when_text || copy.jobColumn}
                        </p>
                        <p className={`${deskRowMutedClass} text-xs text-ink-soft`}>{item.headline}</p>
                        <p className={`${deskRowMutedClass} text-xs text-ink`}>
                          {item.callerName || "Caller"}
                        </p>
                        <div className={`${deskRowActionClass} mt-1`}>
                          <InboxJobActions id={item.job.id} status={item.job.status} />
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {unscheduled.length ? (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Time TBD
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {unscheduled.map((visit) => {
              const item = byId.get(visit.id);
              if (!item?.job) return null;
              return (
                <li key={visit.id} className="relative flex flex-wrap items-center justify-between gap-3 py-3">
                  <DeskRowHit
                    href={item.callId ? `/calls/${item.callId}?from=job` : null}
                    label="Conversation"
                  />
                  <div className={deskRowMutedClass}>
                    <p className="text-sm font-semibold text-ink">{item.headline}</p>
                    <p className="text-xs text-ink-soft">{item.callerName || "Caller"}</p>
                  </div>
                  <div className={deskRowActionClass}>
                    <InboxJobActions id={item.job.id} status={item.job.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
