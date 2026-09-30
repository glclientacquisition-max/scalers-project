import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeskAccountBar } from "@/components/DeskAccountBar";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRouteChrome } from "@/components/DeskRouteChrome";
import { DeskNavHost, DeskNeedsCountBridge, DeskScrollRestore } from "@/components/DeskNavState";
import { LiveInbox } from "@/components/LiveInbox";
import { DeskOffline } from "@/components/ui/DeskOffline";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { loadCachedInboxNeedsCount } from "@/lib/inboxLoad";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

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
  const authUser = await getAuthUser();

  if (!authUser) {
    if (await isLegacyAuthenticated()) {
      redirect("/admin");
    }
    redirect("/login");
  }

  const tenant = await getCurrentTenant();
  if (tenant && tenantNeedsOnboarding(tenant)) {
    redirect("/onboarding");
  }

  return (
    <DeskNavHost>
      <div className={deskShellClass}>
        {tenant ? <LiveInbox tenantId={tenant.id} /> : null}
        <DeskRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DeskAccountBar
            tenantId={tenant?.id || ""}
            businessName={tenant?.business_name || null}
          />
          <DeskOffline />
          <main data-desk-main="" className={deskMainClass}>
            <Suspense fallback={null}>
              <DeskPhonePull />
            </Suspense>
            {children}
            <Suspense fallback={null}>
              <DeskScrollRestore />
              <DeskRouteChrome />
            </Suspense>
          </main>
          <DeskTabBar />
        </div>
        <Suspense fallback={null}>
          <DeskNeedsCountLive tenantId={tenant?.id} vertical={tenant?.vertical} />
        </Suspense>
      </div>
    </DeskNavHost>
  );
}
