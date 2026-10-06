import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";

export type OverviewQueueRow = {
  key: string;
  title: string;
  detail: string;
  href: string;
  stamp: string;
};

export type OverviewGlance = {
  totalBusinesses: number;
  activeBusinesses: number;
  waitingForNumber: number;
  withoutPackage: number;
  availableDids: number;
  assignedDids: number;
  callsLast7Days: number;
};

export function AdminOverviewPanel({
  queue,
  needsNumber,
  strip,
  glance,
}: {
  queue: OverviewQueueRow[];
  needsNumber: boolean;
  strip: { tone: "ok" | "attention" | "down"; label: string };
  glance: OverviewGlance;
}) {
  const showAddNumber = queue.length > 0 && needsNumber;
  const stripTone = strip.tone === "ok" ? "ok" : "attention";
  const stripStamp = strip.tone === "ok" ? "Ok" : strip.tone === "down" ? "Down" : "Needs you";
  const emptyLine = needsNumber
    ? "Add a number when a business needs one."
    : "Assign a package when a shop has none.";
  const emptyAction = needsNumber ? (
    <ButtonLink href="/admin/numbers">Add number</ButtonLink>
  ) : (
    <ButtonLink href="/admin/packages">Packages</ButtonLink>
  );

  return (
    <div className="space-y-8">
      <section>
        <p className="px-4 text-caption text-ink-3">Needs you</p>
        {queue.length === 0 ? (
          <Empty title="Nothing waiting." line={emptyLine} action={emptyAction} />
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

      <section>
        <p className="px-4 text-caption text-ink-3">Glance</p>
        <ul className="divide-y divide-hairline">
          <ListRow
            href="/admin/platform"
            title="Platform"
            preview={strip.label}
            stamp={<Stamp tone={stripTone}>{stripStamp}</Stamp>}
          />
          <ListRow
            href="/admin/businesses"
            title="Businesses"
            preview={
              glance.waitingForNumber > 0
                ? `${glance.waitingForNumber} waiting`
                : `${glance.activeBusinesses} live`
            }
            stamp={
              glance.waitingForNumber > 0 ? (
                <Stamp tone="attention">Waiting</Stamp>
              ) : (
                <Stamp tone="neutral">{glance.totalBusinesses}</Stamp>
              )
            }
          />
          <ListRow
            href="/admin/numbers"
            title="Numbers"
            preview={glance.availableDids === 0 ? "None available" : `${glance.availableDids} available`}
            stamp={
              glance.availableDids === 0 ? (
                <Stamp tone="attention">Empty</Stamp>
              ) : (
                <Stamp tone="neutral">{glance.assignedDids}</Stamp>
              )
            }
          />
          <ListRow
            href="/admin/packages"
            title="Packages"
            preview={
              glance.withoutPackage > 0
                ? `${glance.withoutPackage} without a package`
                : "All assigned"
            }
            stamp={
              glance.withoutPackage > 0 ? (
                <Stamp tone="attention">None</Stamp>
              ) : (
                <Stamp tone="ok">Ok</Stamp>
              )
            }
          />
          <ListRow
            title="Calls"
            preview={`${glance.callsLast7Days} in 7 days`}
            stamp={<Stamp tone="neutral">{glance.callsLast7Days}</Stamp>}
          />
        </ul>
      </section>
    </div>
  );
}
