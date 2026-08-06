import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated, isLegacyAuthenticated } from "@/lib/auth";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const showOpsNav = await isLegacyAuthenticated();

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
              Business
            </Link>
            {showOpsNav ? (
              <Link href="/numbers" className="text-[var(--ink)] hover:text-[var(--accent)]">
                DID pool
              </Link>
            ) : null}
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
