import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/numbers", label: "Numbers" },
];

/**
 * Super Admin root layout — platform operations only.
 * Completely separate from the workspace desk shell: owners are
 * bounced to their own desk, unauthenticated visitors to login.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLegacyAuthenticated())) {
    redirect((await getAuthUser()) ? "/calls" : "/login");
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-[var(--line)]/80 bg-[#122622] text-[#e8f0ec] lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-6 py-5 lg:block">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#9db8ae]">Super Admin</p>
            <Link href="/admin" className="mt-1 block font-display text-2xl text-white">
              Sauti Platform
            </Link>
          </div>
          <form action="/api/logout" method="post" className="lg:hidden">
            <button type="submit" className="text-sm text-[#9db8ae] hover:text-white">
              Sign out
            </button>
          </form>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 pb-4 lg:mt-4 lg:flex-col lg:px-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-[#c7d6cf] hover:bg-white/10 hover:text-white transition whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block lg:px-7 lg:pb-8 lg:pt-6">
          <form action="/api/logout" method="post">
            <button type="submit" className="text-sm text-[#9db8ae] hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-6 py-10 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 border-b border-[var(--line)]/80 pb-5">
            <h1 className="font-display text-3xl tracking-tight text-[var(--accent-deep)] sm:text-4xl">
              Platform control
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--ink-soft)] leading-relaxed">
              Manage businesses, phone numbers, and platform health. Business owners never see
              this area.
            </p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
