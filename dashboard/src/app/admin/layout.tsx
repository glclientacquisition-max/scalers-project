import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/numbers", label: "Numbers" },
];

/**
 * Super Admin shell. Platform ops only; separate from the owner workspace.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLegacyAuthenticated())) {
    redirect((await getAuthUser()) ? "/calls" : "/login");
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="flex flex-col border-b border-white/10 bg-brand-900 text-white lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:border-white/10">
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <BrandLockup
            href="/admin"
            name="Scalers"
            context="Super Admin"
            onDark
            size="md"
            priority
          />
          <form action="/api/logout" method="post" className="lg:hidden">
            <button type="submit" className="text-sm text-brand-200 hover:text-white">
              Sign out
            </button>
          </form>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-1 lg:flex-col lg:px-3 lg:pb-0">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100/85 transition hover:bg-white/10 hover:text-white whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto hidden border-t border-white/10 px-5 py-5 lg:block">
          <BrandLockup href="/admin" name="Scalers" context="Platform" onDark size="sm" />
          <form action="/api/logout" method="post" className="mt-4">
            <button type="submit" className="text-sm text-brand-200 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 border-b border-line/80 pb-5 lg:hidden">
            <BrandLockup href="/admin" name="Scalers" context="Super Admin" size="sm" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
