import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Workspace shell for authenticated business owners.
 * Sticky header (brand + md+ links + Sign out). Same DESK_LINKS as a phone tab bar.
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

  const businessName = tenant?.business_name?.trim() || "Workspace";

  return (
    <div className="min-h-screen min-w-0">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-3.5">
          <div className="min-w-0 flex-1">
            <BrandLockup
              href="/home"
              name="Scalers"
              context={businessName}
              size="md"
              priority
              className="max-w-full"
            />
          </div>
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:pt-10 md:pb-10">
        {children}
      </main>
      <DeskTabBar />
    </div>
  );
}
