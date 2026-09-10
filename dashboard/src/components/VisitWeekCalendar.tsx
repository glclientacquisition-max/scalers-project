import Link from "next/link";
import type { InboxItem } from "@/lib/inboxPurpose";
import {
  groupVisitsForWeek,
  visitClockLabel,
  weekHeading,
  type CalendarVisit,
  type WeekDay,
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

function statusStamp(status: string) {
  return String(status || "").toLowerCase() === "confirmed" ? "Confirmed" : "Open";
}

function VisitLine({
  visit,
  item,
}: {
  visit: CalendarVisit;
  item: InboxItem;
}) {
  const clock = visitClockLabel(visit);
  const service = visit.service_name || item.headline || "Visit";
  const name = item.callerName || "Caller";
  const place = visit.address_landmark?.trim() || "";
  const nameNode = item.contactId ? (
    <Link
      href={`/contacts/${item.contactId}`}
      className="text-[#005CCC] hover:underline focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
    >
      {name}
    </Link>
  ) : (
    name
  );

  return (
    <li className="border-t border-line/70 pt-1.5 first:border-t-0 first:pt-0">
      <p className="truncate text-sm text-ink">
        <span className="font-semibold tabular-nums">{clock}</span>
        <span className="text-ink-soft"> · </span>
        {service}
        <span className="text-ink-soft"> · </span>
        {nameNode}
        {place ? (
          <>
            <span className="text-ink-soft"> · </span>
            {place}
          </>
        ) : null}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        {statusStamp(visit.status)}
      </p>
    </li>
  );
}

function DayColumn({
  day,
  rows,
  byId,
}: {
  day: WeekDay;
  rows: CalendarVisit[];
  byId: Map<string, InboxItem>;
}) {
  return (
    <section
      className={[
        "min-h-[11rem] bg-surface p-3",
        day.isToday ? "bg-[#0096FF]/[0.06] ring-1 ring-inset ring-[#0096FF]/30" : "",
      ].join(" ")}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {day.weekdayShort} {day.dayNum}
      </h2>
      <ul className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <li className="text-xs text-ink-soft">None</li>
        ) : (
          rows.map((visit) => {
            const item = byId.get(visit.id);
            if (!item?.job) return null;
            return <VisitLine key={visit.id} visit={visit} item={item} />;
          })
        )}
      </ul>
    </section>
  );
}

export function VisitWeekCalendar({
  items,
  monday,
  prevHref,
  nextHref,
  todayHref,
  listHref,
}: {
  items: InboxItem[];
  monday: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  listHref: string;
}) {
  const byId = new Map(items.filter((item) => item.job).map((item) => [item.job!.id, item]));
  const visits = items.map(jobToVisit).filter((row): row is CalendarVisit => Boolean(row));
  const { days, byDay, unscheduled } = groupVisitsForWeek(visits, monday);
  const heading = weekHeading(monday);
  const todayIdx = days.findIndex((day) => day.isToday);
  const start = todayIdx >= 0 ? todayIdx : 0;
  const nearDays = days.slice(start, start + 3);
  const restDays = [...days.slice(0, start), ...days.slice(start + 3)];

  return (
    <div id="eat-today" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-sm font-semibold text-ink">{heading}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={todayHref}
            className="inline-flex min-h-11 items-center rounded-xl bg-[#0096FF] px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
          >
            Today
          </Link>
          <Link
            href={prevHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-[#0096FF] focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
          >
            Prev
          </Link>
          <Link
            href={nextHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-[#0096FF] focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
          >
            Next
          </Link>
        </div>
      </div>

      <div className="mt-4 space-y-2 sm:hidden">
        {nearDays.map((day) => (
          <DayColumn key={day.key} day={day} rows={byDay[day.key] || []} byId={byId} />
        ))}
        {restDays.length ? (
          <details className="rounded-2xl border border-line bg-surface p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-[#0096FF]">
              Rest of week
            </summary>
            <div className="mt-3 space-y-2">
              {restDays.map((day) => (
                <DayColumn key={day.key} day={day} rows={byDay[day.key] || []} byId={byId} />
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-line bg-line sm:grid sm:grid-cols-7 sm:gap-px">
        {days.map((day) => (
          <DayColumn key={day.key} day={day} rows={byDay[day.key] || []} byId={byId} />
        ))}
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
                <li key={visit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="truncate text-sm text-ink">
                    {item.headline}
                    <span className="text-ink-soft"> · </span>
                    {item.callerName || "Caller"}
                  </p>
                  <Link
                    href={listHref}
                    className="text-sm font-medium text-[#005CCC] hover:underline focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
                  >
                    List
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
