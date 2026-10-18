import { emptyCallSetup } from "@/lib/callSetupStore";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskAccountMenu } from "@/components/DeskAccountMenu";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { ThemePicker } from "@/components/ThemePicker";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { HomeCapture } from "@/components/HomeCapture";
import { HomeReviewSettingsNudge } from "@/components/HomeReviewSettingsNudge";
import { HomeCallSetupCard } from "@/components/HomeCallSetupCard";
import { LivePing } from "@/components/ui/deskRow";
import { homeStakes, shopStakes } from "@/lib/baStakes";
import { CapabilityGatesPanel } from "@/components/CapabilityGatesPanel";
import { capabilityGates } from "@/lib/capabilityGates";
import type { TenantRow } from "@/lib/supabase";

/**
 * Local Overview identity harness (no desk login). DASHBOARD_OPEN=true only.
 */
function devCallSetupFixture(state: string | undefined, now: number) {
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const base = { ...emptyCallSetup(), option: "forward" as const, network: "safaricom" as const };
  if (state === "pending") return { setup: { ...base, opened_at: ago(0.05) }, activity: { firstCallAfterOpenAt: null, lastCallAt: null } };
  if (state === "auto") return { setup: { ...base, opened_at: ago(2) }, activity: { firstCallAfterOpenAt: ago(1), lastCallAt: ago(1) } };
  if (state === "nudge")
    return {
      setup: { ...base, opened_at: ago(12), tested_at: ago(10), tested_via: "manual" as const },
      activity: { firstCallAfterOpenAt: null, lastCallAt: ago(9) },
    };
  return null;
}

export default async function DevHomePage({ searchParams }: { searchParams: Promise<{ vertical?: string; tenant?: string; calls?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  const sp = await searchParams;
  const home = sp.vertical === "home_services";
  // Same localStorage key as /dev/setup/line?tenant=x, so "I tested it" there hides the card here.
  const callSetupTenant = `dev-tenant${sp.tenant ? `-${sp.tenant.replace(/[^a-z0-9-]/gi, "").slice(0, 24)}` : ""}`;
  // ?calls=pending|auto|nudge: account-backed card states (no DB in the fixture).
  const callFixture = devCallSetupFixture(sp.calls, Date.now());
  const gates = capabilityGates(
    home
      ? { vertical: "home_services", services_catalog: [{ name: "Sofa cleaning", source: "owner" }] }
      : { vertical: "retail", business_policies: {} },
    { holdGate: home ? null : { allowed: false, reasons: ["Holds are not enabled in policies."] } },
  );

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
              stakes={
                home
                  ? homeStakes({ services: [], coverage: "Kilimani", bookingSlotsAllowed: false })
                  : shopStakes({ products: [], hoursText: "", holdsAllowed: false })
              }
            />
            <HomeCallSetupCard
              tenantId={callSetupTenant}
              numberReady
              supported={Boolean(callFixture)}
              status={callFixture ? resolveCallSetupStatus({ numberReady: true, ...callFixture, now: Date.now() }) : null}
            />
            <CapabilityGatesPanel gates={gates} />
            <HomeReviewSettingsNudge
              tenantId="dev-home-live-nudge"
              vertical="retail"
              score={{
                overall: 42,
                domains: {
                  identity: 100,
                  catalog: 0,
                  hours: 50,
                  locations: 50,
                  payments: 0,
                  policies: 0,
                  faqs: 0,
                  team_notify: 50,
                  assistant: 100,
                  bulletin: 0,
                },
                ready_badge: false,
                next_gaps: [
                  {
                    domain: "catalog",
                    action: "Add products or services with names and prices.",
                  },
                ],
              }}
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
