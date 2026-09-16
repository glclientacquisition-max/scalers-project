import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";
import { LiveInbox } from "@/components/LiveInbox";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Workspace shell for authenticated business owners.
 * Sticky header (Scalers + md+ links + Sign out). Same DESK_LINKS as a phone tab bar.
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
    <div className="desk-theme min-h-screen min-w-0">
      {tenant ? <LiveInbox tenantId={tenant.id} /> : null}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <BrandLockup href="/home" name="Scalers" size="sm" priority className="max-w-full" />
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-10">
        {children}
      </main>
      <DeskTabBar />
    </div>
  );
}
