import { DeltaMark } from "@/components/admin/QualityBits";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { todayQueueGroups, type TodayNumberRow, type TodayQueueRow } from "@/lib/adminTodayModel";

export type TodayStatus = { tone: "ok" | "attention" | "down"; text: string };

/**
 * Super Admin Today. Platform, grouped Needs you, then volume.
 * Every figure comes from recorded calls; gaps say so.
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
  const groups = todayQueueGroups(queue);
  const showAddNumber = queue.some((row) => row.stamp === "Waiting" || row.stamp === "Stuck") && needsNumber;

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Today" subtitle={dayLabel} />

      <section aria-labelledby="today-status">
        <h2 id="today-status" className="px-4 text-caption text-ink-3">
          Platform
        </h2>
        <ul className="divide-y divide-hairline">
          <ListRow href="/admin/platform" title={status.text} preview="Open notices and line health" stamp={statusStamp} />
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
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="px-4 pb-1 text-meta text-ink-3">{group.title}</p>
                <ul className="divide-y divide-hairline">
                  {group.rows.map((row) => (
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
              </div>
            ))}
          </div>
        )}
        {showAddNumber ? (
          <div className="px-4 pt-3">
            <ButtonLink href="/admin/numbers">Add number</ButtonLink>
          </div>
        ) : null}
      </section>

      <section id="calls" aria-labelledby="today-calls" className="scroll-mt-4">
        <h2 id="today-calls" className="px-4 text-caption text-ink-3">
          Volume today
        </h2>
        <ul className="divide-y divide-hairline">
          {numbers.map((row) => (
            <ListRow
              key={row.key}
              href={row.href}
              title={row.title}
              preview={row.detail}
              when={
                row.available ? (
                  <span className="inline-flex items-baseline gap-2 tabular-nums">
                    <span className="text-body text-ink">{row.value}</span>
                    <DeltaMark delta={row.delta} lowerIsBetter={row.lowerIsBetter} />
                  </span>
                ) : undefined
              }
              stamp={row.available ? undefined : <Stamp tone="neutral">{row.href ? "Open" : "Not yet"}</Stamp>}
            />
          ))}
        </ul>
        <p className="px-4 pt-2 text-meta text-ink-3">Counted from midnight, East Africa time.</p>
      </section>
    </div>
  );
}
