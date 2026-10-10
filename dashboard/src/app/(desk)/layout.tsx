import { Suspense } from "react";
import { deskMemberRole } from "@/lib/requireMember";
import { hiddenDeskHrefs } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { DeskAccountBar } from "@/components/DeskAccountBar";
import { DeskPageSkeleton } from "@/components/DeskPageSkeleton";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRouteChrome } from "@/components/DeskRouteChrome";
import { DeskNavHost, DeskNeedsCountBridge, DeskPendingSlot, DeskScrollRestore } from "@/components/DeskNavState";
import { LiveInbox } from "@/components/LiveInbox";
import { DeskOffline } from "@/components/ui/DeskOffline";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { createDeskTimer } from "@/lib/deskTiming";
import { loadCachedInboxNeedsCount } from "@/lib/inboxLoad";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getDeskShellTenant } from "@/lib/tenant";

// instant = false: owner cookie session must run before chrome. Do not wrap the gate in Suspense.
export const instant = false;

async function DeskNeedsCountLive({
  tenantId,
  vertical,
}: {
  tenantId?: string;
  vertical?: string | null;
}) {
  const needsCount = tenantId ? await loadCachedInboxNeedsCount(tenantId, vertical) : 0;
  return <DeskNeedsCountBridge count={needsCount} />;
}

/**
 * Workspace shell for authenticated business owners.
 * md+: DESK_LINKS as a left icon rail. Phone: the same list as bottom tabs. No sticky lockup.
 */
export default async function AppShell({ children }: { children: React.ReactNode }) {
  const timer = createDeskTimer();
  const authUser = await getAuthUser();
  timer.mark("auth");

  if (!authUser) {
    if (await isLegacyAuthenticated()) {
      redirect("/admin");
    }
    redirect("/login");
  }

  const tenant = await getDeskShellTenant();
  timer.mark("shell");
  console.info(timer.line("desk-shell"));
  if (tenant && tenantNeedsOnboarding(tenant)) {
    redirect("/onboarding");
  }

  const hideHrefs = hiddenDeskHrefs(await deskMemberRole(tenant?.id));

  return (
    <DeskNavHost>
      <div className={deskShellClass}>
        {tenant ? <LiveInbox tenantId={tenant.id} /> : null}
        <DeskRail hideHrefs={hideHrefs} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div
                className="min-h-12 shrink-0 border-b border-line bg-surface"
                aria-hidden="true"
              />
            }
          >
            <DeskAccountBar
              tenantId={tenant?.id || ""}
              businessName={tenant?.business_name || null}
            />
          </Suspense>
          <DeskOffline />
          <main data-desk-main="" className={deskMainClass}>
            <Suspense fallback={null}>
              <DeskPhonePull />
            </Suspense>
            <Suspense fallback={<DeskPageSkeleton />}>
              <DeskPendingSlot>{children}</DeskPendingSlot>
            </Suspense>
            <Suspense fallback={null}>
              <DeskScrollRestore />
              <DeskRouteChrome />
            </Suspense>
          </main>
          <DeskTabBar hideHrefs={hideHrefs} />
        </div>
        <Suspense fallback={null}>
          <DeskNeedsCountLive tenantId={tenant?.id} vertical={tenant?.vertical} />
        </Suspense>
      </div>
    </DeskNavHost>
  );
}
