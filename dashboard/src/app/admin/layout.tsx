import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { AdminNav } from "@/components/AdminNav";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

/**
 * Super Admin shell.
 * Mobile: top brand + horizontal nav. Desktop: navy sidebar + content.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLegacyAuthenticated())) {
    redirect((await getAuthUser()) ? "/home" : "/login");
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 z-40 flex flex-col border-b border-white/10 bg-brand-900 text-white lg:min-h-screen lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r lg:border-white/10">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:py-5">
          <BrandLockup
            href="/admin"
            name="Scalers"
            context="Super Admin"
            onDark
            size="md"
            priority
          />
          <form action="/api/logout" method="post" className="lg:hidden">
            <button type="submit" className="text-sm text-sky-200/80 hover:text-white">
              Sign out
            </button>
          </form>
        </div>

        <div className="px-3 pb-3 lg:flex-1 lg:pb-0">
          <AdminNav onDark />
        </div>

        <div className="mt-auto hidden border-t border-white/10 px-5 py-5 lg:block">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-200/55">
            Scalers Platform
          </p>
          <form action="/api/logout" method="post" className="mt-3">
            <button type="submit" className="text-sm text-sky-200/80 hover:text-white">
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
