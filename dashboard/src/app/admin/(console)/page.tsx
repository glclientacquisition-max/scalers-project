import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { SautikitTelecomPanel } from "@/components/SautikitTelecomPanel";
import { adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { btnGhost, btnPrimary, deskPreviewClass } from "@/components/ui/deskChrome";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { Empty } from "@/components/ui/Empty";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";

// instant = false: request-time Super Admin data under the admin auth shell.
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
  try {
    overview = await getAdminOverview();
  } catch (err) {
    logAdminError("overview", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-8">
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
          hint={`${overview.assignedDids} assigned`}
        />
        <Kpi label="Calls (7 days)" value={overview.callsLast7Days} />
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/admin/numbers" className={btnPrimary}>
          Add / manage numbers
        </Link>
        <Link href="/admin/packages" className={btnGhost}>
          Packages
        </Link>
        <Link href="/admin/wallets" className={btnGhost}>
          Manage wallets
        </Link>
        <Link href="/admin/businesses" className={btnGhost}>
          View businesses
        </Link>
      </section>

      <SautikitTelecomPanel />

      <section>
        <h2 className="text-title font-medium text-ink">Needs attention</h2>
        {overview.attention.length === 0 ? (
          <Empty title="Nothing waiting." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-2">
                <tr className="border-b border-line/70">
                  <th className={adminThClass}>Business</th>
                  <th className={adminThClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.attention.map((b) => (
                  <tr key={b.id} className="relative border-t border-line/70">
                    <td className={adminTdClass}>
                      <DeskRowHit href="/admin/businesses" label={b.business_name} />
                      <p className={`${deskRowMutedClass} font-medium text-ink ${deskPreviewClass}`}>{b.business_name}</p>
                    </td>
                    <td className={`${adminTdClass} text-ink-2`}>
                      <span className={deskRowMutedClass}>
                        {b.status === "waiting" ? "Waiting for a number" : "Archived"}
                      </span>
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
