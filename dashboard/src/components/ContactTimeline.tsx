import { ContactTimelineWhat } from "@/components/ContactTimelineWhat";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewCellClass } from "@/components/ui/deskChrome";
import { formatCallWhen } from "@/lib/callsTriage";
import type { ContactTimelineEntry } from "@/lib/contactsLoad";

function kindLabel(kind: ContactTimelineEntry["kind"]): string {
  if (kind === "request") return "Request";
  if (kind === "appointment") return "Visit";
  return "Call";
}

function TimelineRowHit({ entry }: { entry: ContactTimelineEntry }) {
  return entry.callId ? (
    <DeskRowHit href={`/calls/${entry.callId}`} label="Conversation" />
  ) : null;
}

export function ContactTimeline({ entries }: { entries: ContactTimelineEntry[] }) {
  if (!entries.length) {
    return <p className="mt-4 text-sm text-ink-soft">No calls or jobs yet.</p>;
  }

  return (
    <>
      <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={[
              "relative min-w-0 border-t border-line/70 px-3 py-3 first:border-t-0",
              entry.callId ? "cursor-pointer" : "",
            ].join(" ")}
          >
            <TimelineRowHit entry={entry} />
            <div className={`${deskRowMutedClass} flex min-w-0 items-baseline justify-between gap-2`}>
              <p className="truncate text-xs tabular-nums text-ink-soft">
                {formatCallWhen(entry.createdAt)}
              </p>
              <p className="shrink-0 text-xs text-ink-soft">{kindLabel(entry.kind)}</p>
            </div>
            <div className={`${deskRowActionClass} mt-1 min-w-0`}>
              <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden min-w-0 overflow-x-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full min-w-0 text-left text-sm">
          <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
            <tr>
              <th
                scope="col"
                className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
              >
                When
              </th>
              <th
                scope="col"
                className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
              >
                Type
              </th>
              <th
                scope="col"
                className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
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
                  "relative border-t border-line/70",
                  entry.callId ? "cursor-pointer hover:bg-accent/[0.04]" : "",
                ].join(" ")}
              >
                <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-4 text-ink-soft`}>
                  <TimelineRowHit entry={entry} />
                  {formatCallWhen(entry.createdAt)}
                </td>
                <td className={`${deskRowMutedClass} px-5 py-4 text-ink`}>{kindLabel(entry.kind)}</td>
                <td className={`${deskPreviewCellClass} px-5 py-4`}>
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
