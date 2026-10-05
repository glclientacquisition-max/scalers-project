import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { btnGhost, btnPrimary, deskPreviewClass } from "@/components/ui/deskChrome";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { Empty } from "@/components/ui/Empty";
import { Stamp } from "@/components/ui/Stamp";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";
import { mergeQueueRows } from "@/lib/platformOpsModel";

export const instant = false;

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="border-t border-line/70 px-4 py-3 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <p className="text-body font-medium tabular-nums text-ink">{value}</p>
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
        className="flex min-h-11 items-center justify-between gap-3 border-y border-line/70 px-4 py-3"
      >
        <div>
          <p className="text-meta text-ink-2">Platform</p>
          <p className="text-body font-medium text-ink">{ops.strip.label}</p>
        </div>
        <Stamp tone={stripTone}>{ops.strip.tone === "ok" ? "OK" : "Needs you"}</Stamp>
      </Link>

      <section className="grid border-y border-line/70 sm:grid-cols-2 lg:grid-cols-4" aria-label="Overview totals">
        <Kpi label="Businesses" value={overview.totalBusinesses} hint={`${overview.activeBusinesses} live`} />
        <Kpi
          label="Waiting for a number"
          value={overview.waitingForNumber}
          hint="Need a DID from the pool"
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

      <section className="flex flex-wrap gap-3">
        <Link href="/admin/numbers" className={btnPrimary}>
          Add number
        </Link>
        <Link href="/admin/packages" className={btnGhost}>
          Packages
        </Link>
        <Link href="/admin/businesses" className={btnGhost}>
          View businesses
        </Link>
      </section>

      <section>
        <h2 className="text-title font-medium text-ink">Needs you</h2>
        {queue.length === 0 ? (
          <Empty title="Nothing waiting." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-2">
                <tr className="border-b border-line/70">
                  <th className={adminThClass}>Item</th>
                  <th className={adminThClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.key} className="relative border-t border-line/70">
                    <td className={adminTdClass}>
                      <DeskRowHit href={row.href} label={row.title} />
                      <p className={`${deskRowMutedClass} font-medium text-ink ${deskPreviewClass}`}>{row.title}</p>
                    </td>
                    <td className={`${adminTdClass} text-ink-2`}>
                      <span className={deskRowMutedClass}>{row.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
