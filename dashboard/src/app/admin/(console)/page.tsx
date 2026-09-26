import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { SautikitTelecomPanel } from "@/components/SautikitTelecomPanel";
import { btnGhost, btnPrimary } from "@/components/ui/deskChrome";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";

// instant = false: request-time Super Admin data under the admin auth shell.
export const instant = false;

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
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
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <h2 className="px-4 pt-4 font-display text-2xl tracking-tight sm:px-5">Needs attention</h2>
        {overview.attention.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft sm:px-5">Nothing waiting.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-soft">
                <tr className="border-b border-line/70">
                  <th className="px-4 py-2 font-medium sm:px-5">Business</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.attention.map((b) => (
                  <tr key={b.id} className="relative border-t border-line/70 hover:bg-accent-soft/40">
                    <td className="px-4 py-3 sm:px-5">
                      <DeskRowHit href="/admin/businesses" label={b.business_name} />
                      <p className={`${deskRowMutedClass} font-medium text-ink`}>{b.business_name}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-soft sm:px-5">
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
