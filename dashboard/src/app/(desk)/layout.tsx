import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Workspace desk shell for authenticated business owners.
 * Super Admin (legacy cookie) sessions route to /admin.
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
    <div className="min-h-screen">
      <header className="border-b border-line/80 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-desk items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <BrandMark href="/calls" label="Scalers" priority />
          <nav className="flex items-center gap-3 text-sm sm:gap-5">
            <Link href="/calls" className="text-ink hover:text-accent">
              Calls
            </Link>
            <Link href="/settings" className="text-ink hover:text-accent">
              Business
            </Link>
            <Link href="/wallet" className="text-ink hover:text-accent">
              Wallet
            </Link>
            <form action="/api/logout" method="post">
              <button type="submit" className="text-ink-soft hover:text-warn">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-desk px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
