import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/numbers", label: "Numbers" },
];

/**
 * Super Admin root layout. Platform ops only; separate from the owner desk.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLegacyAuthenticated())) {
    redirect((await getAuthUser()) ? "/calls" : "/login");
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-white/10 bg-brand-900 text-white lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:border-white/10">
        <div className="flex items-center justify-between gap-4 px-5 py-5 lg:block">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-brand-200/80">Super Admin</p>
            <BrandMark href="/admin" label="Sauti" invert className="mt-2" priority />
          </div>
          <form action="/api/logout" method="post" className="lg:hidden">
            <button type="submit" className="text-sm text-brand-200 hover:text-white">
              Sign out
            </button>
          </form>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:mt-2 lg:flex-col lg:px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-brand-100/80 transition hover:bg-white/10 hover:text-white whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block lg:px-6 lg:pb-8 lg:pt-6">
          <form action="/api/logout" method="post">
            <button type="submit" className="text-sm text-brand-200 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
