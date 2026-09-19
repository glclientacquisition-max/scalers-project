import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { SautikitTelecomPanel } from "@/components/SautikitTelecomPanel";
import { btnPrimary } from "@/components/ui/deskChrome";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight text-[var(--ink)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--ink-soft)]">{hint}</p> : null}
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
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <Link
          href="/admin/numbers"
          className={btnPrimary}
        >
          Add / manage numbers
        </Link>
        <Link
          href="/admin/wallets"
          className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]"
        >
          Manage wallets
        </Link>
        <Link
          href="/admin/businesses"
          className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]"
        >
          View businesses
        </Link>
      </section>

      <SautikitTelecomPanel />

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Needs attention</h2>
        {overview.attention.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--ink-soft)]">Nothing waiting. Pool and businesses look healthy.</p>
        ) : (
          <ul className="mt-5 divide-y divide-[var(--line)]/70">
            {overview.attention.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{b.business_name}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {b.status === "waiting" ? "Waiting for a number" : "Archived"}
                  </p>
                </div>
                <Link
                  href="/admin/businesses"
                  className="text-sm text-[var(--accent)] hover:text-[var(--accent-deep)]"
                >
                  Manage →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
