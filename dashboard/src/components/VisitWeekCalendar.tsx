import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewClass } from "@/components/ui/deskChrome";
import type { InboxItem } from "@/lib/inboxPurpose";
import { nicheCopy } from "@/lib/inboxNiche";
import { groupRunSheetForWeek } from "@/lib/runSheet";
import { weekHeading } from "@/lib/visitCalendar";

function RowAction({ item }: { item: InboxItem }) {
  if (item.job) {
    return <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />;
  }
  if (item.hold) {
    return <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={false} />;
  }
  return null;
}

export function VisitWeekCalendar({
  items,
  monday,
  prevHref,
  nextHref,
  vertical,
}: {
  items: InboxItem[];
  monday: string;
  prevHref: string;
  nextHref: string;
  businessName: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  const byId = new Map<string, InboxItem>();
  for (const item of items) {
    if (item.job) byId.set(item.job.id, item);
    if (item.hold) byId.set(item.hold.id, item);
  }
  const { days, byDay, unscheduled } = groupRunSheetForWeek(items, monday);
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
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-7">
        {days.map((day) => {
          const rows = byDay[day.key] || [];
          return (
            <section
              key={day.key}
              className={["min-h-[11rem] bg-surface p-3", day.isToday ? "bg-accent/[0.06]" : ""].join(
                " "
              )}
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
                    return (
                      <li
                        key={visit.id}
                        className="relative border-t border-line/70 pt-2 first:border-t-0 first:pt-0"
                      >
                        <DeskRowHit
                          href={item.callId ? `/calls/${item.callId}?from=job` : null}
                          label="Conversation"
                        />
                        <p className={`${deskRowMutedClass} text-sm font-semibold text-ink ${deskPreviewClass}`}>
                          {visit.when_text || copy.jobColumn}
                        </p>
                        <p className={`${deskRowMutedClass} mt-0.5 text-xs text-ink ${deskPreviewClass}`}>{item.headline}</p>
                        <div className={`${deskRowActionClass} mt-1`}>
                          <RowAction item={item} />
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
              if (!item) return null;
              return (
                <li key={visit.id} className="relative flex flex-wrap items-center justify-between gap-3 py-3">
                  <DeskRowHit
                    href={item.callId ? `/calls/${item.callId}?from=job` : null}
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
