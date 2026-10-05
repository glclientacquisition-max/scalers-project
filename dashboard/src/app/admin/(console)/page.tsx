import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { deskPreviewClass } from "@/components/ui/deskChrome";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";
import { mergeQueueRows } from "@/lib/platformOpsModel";

export const instant = false;

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="border-t border-hairline px-4 py-3 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <p className="text-title font-medium tabular-nums text-ink">{value}</p>
      <p className={`mt-0.5 text-meta text-ink-2 ${deskPreviewClass}`}>{label}</p>
      {hint ? <p className={`text-meta text-ink-3 ${deskPreviewClass}`}>{hint}</p> : null}
    </div>
  );
}

export default async function AdminOverviewPage() {
  let overview;
  let ops;
  try {
    [overview, ops] = await Promise.all([getAdminOverview(), evaluatePlatformOps()]);
  } catch (err) {
    logAdminError("overview", err);
    return <AdminSetupError />;
  }

  const queue = mergeQueueRows({
    notices: ops.notices.map((notice) => ({
      kind: notice.kind,
      detail: notice.detail,
      status: notice.status,
    })),
    businesses: overview.attention.map((b) => ({
      id: b.id,
      name: b.business_name,
      status: b.status,
    })),
  });

  const stripTone = ops.strip.tone === "ok" ? "ok" : "attention";

  return (
    <div className="space-y-8">
      <Link
        href="/admin/platform"
        className="flex min-h-11 items-center justify-between gap-3 border-y border-hairline px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <div>
          <p className="text-meta text-ink-2">Platform</p>
          <p className="text-body font-medium text-ink">{ops.strip.label}</p>
        </div>
        <Stamp tone={stripTone}>{ops.strip.tone === "ok" ? "Ok" : "Needs you"}</Stamp>
      </Link>

      <section className="grid border-y border-hairline sm:grid-cols-2 lg:grid-cols-4" aria-label="Overview totals">
        <Kpi label="Businesses" value={overview.totalBusinesses} hint={`${overview.activeBusinesses} live`} />
        <Kpi
          label="Waiting for a number"
          value={overview.waitingForNumber}
          hint="Need a number from the pool"
        />
        <Kpi
          label="Numbers available"
          value={overview.availableDids}
          hint={
            overview.availableDids === 0
              ? "Add a number to assign"
              : `${overview.assignedDids} assigned`
          }
        />
        <Kpi label="Calls (7 days)" value={overview.callsLast7Days} />
      </section>

      {queue.length > 0 ? (
        <section>
          <ButtonLink href="/admin/numbers">Add number</ButtonLink>
        </section>
      ) : null}

      <section>
        <h2 className="text-title font-medium text-ink">Needs you</h2>
        {queue.length === 0 ? (
          <Empty
            title="Nothing waiting."
            line="Add a number when a business needs one."
            action={<ButtonLink href="/admin/numbers">Add number</ButtonLink>}
          />
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {queue.map((row) => (
              <ListRow
                key={row.key}
                href={row.href}
                title={row.title}
                preview={row.detail || undefined}
                stamp={<Stamp tone="attention">{row.stamp}</Stamp>}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
