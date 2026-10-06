import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskAccountMenu } from "@/components/DeskAccountMenu";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { ThemePicker } from "@/components/ThemePicker";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { HomeCapture } from "@/components/HomeCapture";
import { LivePing } from "@/components/ui/deskRow";
import { shopStakes } from "@/lib/baStakes";
import type { TenantRow } from "@/lib/supabase";

/**
 * Local Overview identity harness (no desk login). DASHBOARD_OPEN=true only.
 */
export default function DevHomePage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={3} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <DeskAccountMenu name="Chapter One Dental" tenantId="" workspaces={[]} />
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <HomeOverviewHeader today={{ iso: "2026-09-20", label: "Sunday 20 September" }} />
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
          <section
            className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1"
            aria-labelledby="work-heading"
          >
            <h2 id="work-heading" className="font-display text-xl tracking-tight text-ink">
              Work
            </h2>
            <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              {["Return calls", "Holds", "Visits"].map((row, index) => (
                <li
                  key={row}
                  className={[
                    "flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium text-ink lg:min-h-11",
                    index === 0 ? undefined : "border-t border-line",
                  ].join(" ")}
                >
                  {row}
                </li>
              ))}
            </ul>
            <HomeCapture
              tenantId="dev-home"
              vertical="retail"
              score={{
                overall: 18,
                domains: {
                  identity: 50,
                  catalog: 0,
                  hours: 0,
                  locations: 0,
                  payments: 0,
                  policies: 0,
                  faqs: 0,
                  team_notify: 0,
                  assistant: 50,
                  bulletin: 0,
                },
                ready_badge: false,
                next_gaps: [
                  {
                    domain: "catalog",
                    action: "Add products or services with owner-confirmed names and prices.",
                  },
                ],
              }}
              stakes={shopStakes({ products: [], hoursText: "", holdsAllowed: false })}
            />
          </section>
          <aside
            className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1"
            aria-label="Today"
          >
            <div className="overflow-hidden rounded-2xl border border-line bg-surface px-4 py-4">
              <p className="text-sm text-ink-soft">Calls today</p>
              <p className="mt-3 text-sm font-medium text-ink">Line live</p>
            </div>
          </aside>
          <section
            className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2"
            aria-labelledby="updates-heading"
          >
            <h2
              id="updates-heading"
              className="flex items-center gap-2 font-display text-xl tracking-tight text-ink"
            >
              <LivePing />
              Updates
            </h2>
            <div className="mt-3">
              <DailyBulletinPanel
                tenant={
                  {
                    id: "dev-home",
                    daily_bulletin: [
                      {
                        id: "dev-live",
                        text: "Out of chicken today",
                        active: true,
                        starts_at: "2026-09-23T00:00:00+03:00",
                        ends_at: "2026-09-23T23:59:59+03:00",
                        created_at: "2026-09-23T08:00:00+03:00",
                      },
                    ],
                  } as TenantRow
                }
              />
            </div>
          </section>
          </div>
          <div className="mt-6 max-w-lg">
            <ThemePicker />
          </div>
        </main>
        <DeskTabBar needsCount={3} />
      </div>
    </div>
  );
}
