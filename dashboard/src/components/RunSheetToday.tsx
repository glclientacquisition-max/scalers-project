import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { btnGhost, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import type { InboxItem } from "@/lib/inboxPurpose";
import { inboxRecordHref, type InboxReturn } from "@/lib/inboxHref";
import { nicheCopy } from "@/lib/inboxNiche";
import { dayHeading } from "@/lib/visitCalendar";
import { formatHoldClock } from "@/lib/holdSheet";
import { formatSlotClock } from "@/lib/runSheet";

function RowAction({ item, purpose }: { item: InboxItem; purpose: "job" | "hold" }) {
  if (purpose === "hold") {
    if (!item.hold) return null;
    return <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={false} />;
  }
  if (!item.job) return null;
  return <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />;
}

export function RunSheetToday({
  items,
  ymd,
  prevHref,
  nextHref,
  listHref,
  ret,
  vertical,
  purpose = "job",
}: {
  items: InboxItem[];
  ymd: string;
  prevHref: string;
  nextHref: string;
  listHref: string;
  ret?: InboxReturn;
  businessName: string;
  vertical?: string | null;
  purpose?: "job" | "hold";
}) {
  const copy = nicheCopy(vertical);
  const heading = dayHeading(ymd);
  const placeFor = (item: InboxItem) => item.job?.address_landmark?.trim() || "";
  const clockFor = (item: InboxItem) =>
    purpose === "hold" ? formatHoldClock(item) : formatSlotClock(item);
  const pile = purpose === "hold" ? "hold" : "job";

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

      {items.length === 0 ? (
        <div className="border-y border-line py-12 text-center">
          <p className="font-display text-2xl tracking-tight text-ink">{copy.todayEmpty}</p>
          <Link href={listHref} className={`${btnGhost} mt-6`}>
            List
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className="relative flex min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0"
              >
                <DeskRowHit
                  href={item.callId ? inboxRecordHref(item.callId, ret || { purpose: pile }) : null}
                  label="Conversation"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={`${deskRowMutedClass} text-sm font-semibold tracking-tight ${deskPreviewClass}`}>
                      {item.callerName || "Caller"}
                    </p>
                    <p className="shrink-0 text-xs text-ink-soft">{clockFor(item)}</p>
                  </div>
                  <p className={`${deskRowMutedClass} mt-0.5 text-sm text-ink ${deskPreviewClass}`}>
                    {item.headline}
                  </p>
                </div>
                <div className={`${deskRowActionClass} flex shrink-0 items-center self-center`}>
                  <RowAction item={item} purpose={purpose} />
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
                    {purpose === "hold" ? "Item" : "Work"}
                  </th>
                  <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                    Who
                  </th>
                  {purpose === "job" ? (
                    <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                      Place
                    </th>
                  ) : null}
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
                        href={item.callId ? inboxRecordHref(item.callId, ret || { purpose: pile }) : null}
                        label="Conversation"
                      />
                      {clockFor(item)}
                    </td>
                    <td className={`px-5 py-3 text-sm text-ink ${deskPreviewCellClass}`}>
                      <p className={deskPreviewClass}>{item.headline}</p>
                    </td>
                    <td className="max-w-[10rem] px-5 py-3 text-sm text-ink">
                      <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
                    </td>
                    {purpose === "job" ? (
                      <td className="max-w-[12rem] px-5 py-3 text-sm text-ink-soft">
                        <p className={deskPreviewClass}>{placeFor(item)}</p>
                      </td>
                    ) : null}
                    <td className="px-5 py-3 text-right">
                      <div className={deskRowActionClass}>
                        <RowAction item={item} purpose={purpose} />
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
