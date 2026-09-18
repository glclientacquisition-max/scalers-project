import { redirect } from "next/navigation";
import { DeskPhoneHeader, DeskRail, DeskTabBar } from "@/components/DeskNav";
import { LiveInbox } from "@/components/LiveInbox";
import { DeskOffline } from "@/components/ui/DeskOffline";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Workspace shell for authenticated business owners.
 * md+: DESK_LINKS as a left rail. Phone: lockup header + the same list as bottom tabs.
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
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh md:overflow-hidden">
      {tenant ? <LiveInbox tenantId={tenant.id} /> : null}
      <DeskRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DeskPhoneHeader />
        <DeskOffline />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[var(--desk-tabbar-clearance)] sm:px-6 md:overflow-y-auto md:p-6 md:has-[[data-desk-bleed]]:h-full md:has-[[data-desk-bleed]]:overflow-hidden md:has-[[data-desk-bleed]]:p-0">
          {children}
        </main>
        <DeskTabBar />
      </div>
    </div>
  );
}
