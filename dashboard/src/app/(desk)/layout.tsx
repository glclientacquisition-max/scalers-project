import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Workspace desk shell — strictly for authenticated business owners.
 * Super Admin (legacy cookie) sessions are routed to /admin instead.
 */
export default async function AppShell({ children }: { children: React.ReactNode }) {
  const authUser = await getAuthUser();

  if (!authUser) {
    // Platform operators have their own root layout at /admin.
    if (await isLegacyAuthenticated()) {
      redirect("/admin");
    }
    redirect("/login");
  }

  // Owners with a blank/default prompt finish guided setup before the desk.
  const tenant = await getCurrentTenant();
  if (tenant && tenantNeedsOnboarding(tenant)) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)]/80 bg-[var(--card)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/calls" className="font-display text-2xl text-[var(--accent-deep)]">
              Sauti Desk
            </Link>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">Missed-call command center</p>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/calls" className="text-[var(--ink)] hover:text-[var(--accent)]">
              Calls
            </Link>
            <Link href="/settings" className="text-[var(--ink)] hover:text-[var(--accent)]">
              Business Settings
            </Link>
            <Link href="/wallet" className="text-[var(--ink)] hover:text-[var(--accent)]">
              Wallet
            </Link>
            <form action="/api/logout" method="post">
              <button type="submit" className="text-[var(--ink-soft)] hover:text-[var(--warn)]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
