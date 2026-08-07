import Link from "next/link";
import { getAdminOverview } from "@/lib/admin";
import { SautikitTelecomPanel } from "@/components/SautikitTelecomPanel";

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
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load overview: {message}
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Apply <code>docs/supabase/did_number_pool.sql</code> and{" "}
          <code>docs/supabase/super_admin_ops.sql</code> if tables/RPCs are missing.
        </p>
      </div>
    );
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
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)]"
        >
          Add / manage numbers
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
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Businesses waiting for a phone number or marked inactive.
        </p>
        {overview.attention.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--ink-soft)]">Nothing waiting — pool and businesses look healthy.</p>
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
