import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { todayQueueGroups, type TodayNumberRow, type TodayQueueRow } from "@/lib/adminTodayModel";

export type TodayStatus = { tone: "ok" | "attention" | "down"; text: string };

/** Super Admin Today. Platform, then shops that need a person. */
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
  const calls = numbers.find((row) => row.key === "calls");

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Today" subtitle={dayLabel} />

      <section aria-labelledby="today-status">
        <h2 id="today-status" className="px-4 text-caption text-ink-3">
          Platform
        </h2>
        <ul className="divide-y divide-hairline">
          <ListRow href="/admin/platform" title={status.text} preview="Notices and line" stamp={statusStamp} />
        </ul>
      </section>

      <section aria-labelledby="today-needs">
        <h2 id="today-needs" className="px-4 text-caption text-ink-3">
          Needs you
        </h2>
        {queue.length === 0 ? (
          <Empty
            title="Nothing waiting."
            line={needsNumber ? "Add a number before the next signup." : undefined}
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

      {calls?.available ? (
        <p className="px-4 text-meta tabular-nums text-ink-2">
          <Link href="/admin/quality" className="text-ink underline-offset-2 hover:underline">
            {calls.value} calls today
          </Link>
        </p>
      ) : null}
    </div>
  );
}
