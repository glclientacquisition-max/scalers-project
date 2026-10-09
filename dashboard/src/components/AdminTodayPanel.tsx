import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import type { TodayNumberRow, TodayQueueRow } from "@/lib/adminTodayModel";

export type TodayStatus = { tone: "ok" | "attention" | "down"; text: string };

/**
 * Super Admin Today. Status line, one merged Needs you queue, then today's calls.
 * Plain rows, no tiles. Every figure comes from recorded calls; gaps say so.
 */
export function AdminTodayPanel({
  dayLabel,
  status,
  queue,
  needsNumber,
  numbers,
}: {
  dayLabel: string;
  status: TodayStatus;
  queue: TodayQueueRow[];
  needsNumber: boolean;
  numbers: TodayNumberRow[];
}) {
  const statusStamp =
    status.tone === "ok" ? (
      <Stamp tone="ok">Ok</Stamp>
    ) : (
      <Stamp tone="attention">{status.tone === "down" ? "Down" : "Check"}</Stamp>
    );
  const showAddNumber = queue.length > 0 && needsNumber;

  return (
    <div className="space-y-8">
      <section aria-labelledby="today-status">
        <h1 id="today-status" className="px-4 text-caption text-ink-3">
          Today · {dayLabel}
        </h1>
        <ul className="divide-y divide-hairline">
          <ListRow href="/admin/platform" title={status.text} preview="Platform" stamp={statusStamp} />
        </ul>
      </section>

      <section aria-labelledby="today-needs">
        <h2 id="today-needs" className="px-4 text-caption text-ink-3">
          Needs you
        </h2>
        {queue.length === 0 ? (
          <Empty
            title="Nothing waiting."
            line={needsNumber ? "Add a number before the next business signs up." : "New problems show up here first."}
            action={needsNumber ? <ButtonLink href="/admin/numbers">Add number</ButtonLink> : undefined}
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {queue.map((row) => (
              <ListRow
                key={row.key}
                href={row.href}
                title={row.title}
                preview={row.detail || undefined}
                unread
                stamp={<Stamp tone="attention">{row.stamp}</Stamp>}
              />
            ))}
          </ul>
        )}
        {showAddNumber ? (
          <div className="px-4 pt-3">
            <ButtonLink href="/admin/numbers">Add number</ButtonLink>
          </div>
        ) : null}
      </section>

      <section id="calls" aria-labelledby="today-calls" className="scroll-mt-4">
        <h2 id="today-calls" className="px-4 text-caption text-ink-3">
          Calls today
        </h2>
        <ul className="divide-y divide-hairline">
          {numbers.map((row) => (
            <ListRow
              key={row.key}
              title={row.title}
              preview={row.detail}
              when={row.available ? <span className="text-body text-ink">{row.value}</span> : undefined}
              stamp={row.available ? undefined : <Stamp tone="neutral">Not yet</Stamp>}
            />
          ))}
        </ul>
        <p className="px-4 pt-2 text-meta text-ink-3">Counted from midnight, East Africa time.</p>
      </section>
    </div>
  );
}
