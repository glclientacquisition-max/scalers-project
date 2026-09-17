import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { btnGhost, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import type { InboxItem } from "@/lib/inboxPurpose";
import { nicheCopy } from "@/lib/inboxNiche";
import { dayHeading } from "@/lib/visitCalendar";
import { formatSlotClock } from "@/lib/runSheet";

function RowAction({ item }: { item: InboxItem }) {
  if (item.job) {
    return <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />;
  }
  if (item.hold) {
    return <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={false} />;
  }
  return null;
}

export function RunSheetToday({
  items,
  ymd,
  prevHref,
  nextHref,
  listHref,
  weekHref,
  vertical,
}: {
  items: InboxItem[];
  ymd: string;
  prevHref: string;
  nextHref: string;
  listHref: string;
  weekHref: string;
  businessName: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  const heading = dayHeading(ymd);
  const placeFor = (item: InboxItem) =>
    item.job?.address_landmark?.trim() || (item.hold ? copy.pickupStamp : "");

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
            href={weekHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent-deep hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Week
          </Link>
          <Link
            href={listHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent-deep hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
          >
            List
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border-y border-line py-12 text-center">
          <p className="font-display text-2xl tracking-tight text-ink">{copy.todayEmpty}</p>
          <Link href={listHref} className={`${btnGhost} mt-6`}>
            List
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line border-y border-line md:hidden">
            {items.map((item) => (
              <li key={item.id} className="relative py-3">
                <DeskRowHit
                  href={item.callId ? `/calls/${item.callId}?from=job` : null}
                  label="Conversation"
                />
                <p className={`${deskRowMutedClass} text-sm font-semibold text-ink`}>
                  {formatSlotClock(item)}
                </p>
                <p className={`${deskRowMutedClass} text-sm text-ink ${deskPreviewClass}`}>{item.headline}</p>
                <p className={`${deskRowMutedClass} text-xs text-ink-soft ${deskPreviewClass}`}>
                  {item.callerName || "Caller"}
                  {placeFor(item) ? ` · ${placeFor(item)}` : ""}
                </p>
                <div className={`${deskRowActionClass} mt-2`}>
                  <RowAction item={item} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden md:block">
            <DeskDataTable minWidthClass="min-w-[720px]">
              <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                <tr>
                  <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                    When
                  </th>
                  <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                    Work
                  </th>
                  <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                    Who
                  </th>
                  <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                    Place
                  </th>
                  <th scope="col" className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.14em]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="relative border-b border-line last:border-b-0">
                    <td className="px-5 py-3 text-sm font-semibold text-ink">
                      <DeskRowHit
                        href={item.callId ? `/calls/${item.callId}?from=job` : null}
                        label="Conversation"
                      />
                      {formatSlotClock(item)}
                    </td>
                    <td className={`px-5 py-3 text-sm text-ink ${deskPreviewCellClass}`}>
                      <p className={deskPreviewClass}>{item.headline}</p>
                    </td>
                    <td className="max-w-[10rem] px-5 py-3 text-sm text-ink">
                      <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
                    </td>
                    <td className={`px-5 py-3 text-sm text-ink-soft ${deskPreviewCellClass}`}>
                      <p className={deskPreviewClass}>{placeFor(item)}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className={deskRowActionClass}>
                        <RowAction item={item} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DeskDataTable>
          </div>
        </>
      )}
    </div>
  );
}
