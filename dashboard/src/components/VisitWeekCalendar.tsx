import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { btnGhost, deskPreviewClass } from "@/components/ui/deskChrome";
import type { InboxItem } from "@/lib/inboxPurpose";
import { inboxRecordHref, type InboxReturn } from "@/lib/inboxHref";
import { nicheCopy } from "@/lib/inboxNiche";
import { groupVisitBoardForWeek } from "@/lib/runSheet";
import { weekHeading, type CalendarVisit, type WeekDay } from "@/lib/visitCalendar";

function RowAction({ item }: { item: InboxItem }) {
  if (!item.job) return null;
  return <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />;
}

function SlotRow({
  visit,
  item,
  ret,
}: {
  visit: CalendarVisit;
  item: InboxItem;
  ret?: InboxReturn;
}) {
  return (
    <li className="relative border-t border-line/70 pt-2 first:border-t-0 first:pt-0">
      <DeskRowHit
        href={item.callId ? inboxRecordHref(item.callId, ret || { purpose: "job" }) : null}
        label="Conversation"
      />
      <p className={`${deskRowMutedClass} text-sm font-semibold text-ink ${deskPreviewClass}`}>
        {visit.when_text || item.headline}
      </p>
      {visit.when_text ? (
        <p className={`${deskRowMutedClass} mt-0.5 text-xs text-ink ${deskPreviewClass}`}>
          {item.headline}
        </p>
      ) : null}
      <div className={`${deskRowActionClass} mt-1`}>
        <RowAction item={item} />
      </div>
    </li>
  );
}

function DaySection({
  day,
  rows,
  byId,
  ret,
  compact,
}: {
  day: WeekDay;
  rows: CalendarVisit[];
  byId: Map<string, InboxItem>;
  ret?: InboxReturn;
  compact?: boolean;
}) {
  return (
    <section
      className={[
        "bg-surface p-3",
        compact ? "" : "min-h-[11rem]",
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
            if (!item) return null;
            return <SlotRow key={visit.id} visit={visit} item={item} ret={ret} />;
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
  listHref,
  ret,
  vertical,
}: {
  items: InboxItem[];
  monday: string;
  prevHref: string;
  nextHref: string;
  listHref: string;
  ret?: InboxReturn;
  businessName: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  const byId = new Map<string, InboxItem>();
  for (const item of items) {
    if (item.job) byId.set(item.job.id, item);
  }
  const { days, byDay, unscheduled } = groupVisitBoardForWeek(items, monday);
  const heading = weekHeading(monday);
  const filledDays = days.filter((day) => (byDay[day.key] || []).length > 0);
  const empty = filledDays.length === 0 && unscheduled.length === 0;

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
        </div>
      </div>

      {empty ? (
        <div className="border-y border-line py-12 text-center">
          <p className="font-display text-2xl tracking-tight text-ink">{copy.jobEmpty}</p>
          <Link href={listHref} className={`${btnGhost} mt-6`}>
            List
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-4 md:hidden">
            {filledDays.map((day) => (
              <DaySection
                key={day.key}
                day={day}
                rows={byDay[day.key] || []}
                byId={byId}
                ret={ret}
                compact
              />
            ))}
          </div>
          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-line bg-line md:grid md:grid-cols-7 md:gap-px">
            {days.map((day) => (
              <DaySection
                key={day.key}
                day={day}
                rows={byDay[day.key] || []}
                byId={byId}
                ret={ret}
              />
            ))}
          </div>
        </>
      )}

      {unscheduled.length ? (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Time TBD
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {unscheduled.map((visit) => {
              const item = byId.get(visit.id);
              if (!item) return null;
              return (
                <li key={visit.id} className="relative flex flex-wrap items-center justify-between gap-3 py-3">
                  <DeskRowHit
                    href={item.callId ? inboxRecordHref(item.callId, ret || { purpose: "job" }) : null}
                    label="Conversation"
                  />
                  <div className={deskRowMutedClass}>
                    <p className={`text-sm font-semibold text-ink ${deskPreviewClass}`}>{item.headline}</p>
                    <p className={`text-xs text-ink-soft ${deskPreviewClass}`}>{item.callerName || "Caller"}</p>
                  </div>
                  <div className={deskRowActionClass}>
                    <RowAction item={item} />
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
