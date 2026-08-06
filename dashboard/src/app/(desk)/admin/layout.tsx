import Link from "next/link";
import { redirect } from "next/navigation";
import { isLegacyAuthenticated } from "@/lib/auth";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/numbers", label: "Numbers" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLegacyAuthenticated())) {
    redirect("/calls");
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 border-b border-[var(--line)]/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Super Admin</p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-[var(--accent-deep)] sm:text-4xl">
            Platform control
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--ink-soft)] leading-relaxed">
            Manage businesses, phone numbers, and platform health. Business owners never see this
            area.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-sm text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent-deep)] transition"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
