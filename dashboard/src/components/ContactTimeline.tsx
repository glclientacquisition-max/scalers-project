import { ContactTimelineWhat } from "@/components/ContactTimelineWhat";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewCellClass } from "@/components/ui/deskChrome";
import { formatCallWhen } from "@/lib/callsTriage";
import type { ContactTimelineEntry } from "@/lib/contactsLoad";

function TimelineRowHit({ entry }: { entry: ContactTimelineEntry }) {
  return entry.href ? <DeskRowHit href={entry.href} label="Conversation" /> : null;
}

export function ContactTimeline({ entries }: { entries: ContactTimelineEntry[] }) {
  if (!entries.length) {
    return <p className="mt-4 text-body text-ink-2">No calls or jobs yet.</p>;
  }

  return (
    <>
      <ul className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface md:hidden">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={[
              "relative min-w-0 border-t border-hairline/70 px-3 py-3 first:border-t-0",
              entry.href ? "cursor-pointer" : "",
            ].join(" ")}
          >
            <TimelineRowHit entry={entry} />
            <div className={`${deskRowMutedClass} flex min-w-0 items-baseline justify-between gap-2`}>
              <p className="truncate text-meta tabular-nums text-ink-2">
                {formatCallWhen(entry.createdAt)}
              </p>
              <InboxPurposeChip purpose={entry.purpose} label={entry.stamp} />
            </div>
            <div className={`${deskRowActionClass} mt-1 min-w-0`}>
              <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden min-w-0 overflow-x-auto rounded-2xl border border-hairline bg-surface md:block">
        <table className="w-full min-w-0 text-left text-body">
          <thead className="border-b border-hairline bg-surface-muted/60 text-ink-2">
            <tr>
              <th
                scope="col"
                className="px-3 py-2 text-meta font-semibold"
              >
                When
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-meta font-semibold"
              >
                Type
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-meta font-semibold"
              >
                What
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className={[
                  "relative border-t border-hairline/70",
                  entry.href ? "cursor-pointer hover:bg-accent/[0.04]" : "",
                ].join(" ")}
              >
                <td className={`${deskRowMutedClass} whitespace-nowrap px-3 py-2 text-ink-2`}>
                  <TimelineRowHit entry={entry} />
                  {formatCallWhen(entry.createdAt)}
                </td>
                <td className={`${deskRowMutedClass} px-3 py-2`}>
                  <InboxPurposeChip purpose={entry.purpose} label={entry.stamp} />
                </td>
                <td className={`${deskPreviewCellClass} px-3 py-2`}>
                  <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
