import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { LiveInbox } from "@/components/LiveInbox";
import { DeskOffline } from "@/components/ui/DeskOffline";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { loadCachedInboxNeedsCount } from "@/lib/inboxLoad";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

async function DeskRailLive({
  tenantId,
  vertical,
}: {
  tenantId?: string;
  vertical?: string | null;
}) {
  const needsCount = tenantId ? await loadCachedInboxNeedsCount(tenantId, vertical) : 0;
  return <DeskRail needsCount={needsCount} />;
}

async function DeskTabBarLive({
  tenantId,
  vertical,
}: {
  tenantId?: string;
  vertical?: string | null;
}) {
  const needsCount = tenantId ? await loadCachedInboxNeedsCount(tenantId, vertical) : 0;
  return <DeskTabBar needsCount={needsCount} />;
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
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      {tenant ? <LiveInbox tenantId={tenant.id} /> : null}
      <Suspense fallback={<DeskRail />}>
        <DeskRailLive tenantId={tenant?.id} vertical={tenant?.vertical} />
      </Suspense>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <DeskOffline />
        <main className={deskMainClass}>{children}</main>
        <Suspense fallback={<DeskTabBar />}>
          <DeskTabBarLive tenantId={tenant?.id} vertical={tenant?.vertical} />
        </Suspense>
      </div>
    </div>
  );
}
