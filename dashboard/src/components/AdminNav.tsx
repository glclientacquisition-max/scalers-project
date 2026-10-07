"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { AdminAccountMenu } from "@/components/AdminAccountMenu";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskHint } from "@/components/ui/DeskHint";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import {
  ADMIN_LINKS,
  adminMainClass,
  adminParentTarget,
  adminRouteActive,
  adminShellClass,
} from "@/lib/adminLinks";
import { PHONE_TAB_REFRESH_EVENT } from "@/lib/endlessList";

function AdminIcon({ name }: { name: string }) {
  const cls = "h-5 w-5";
  if (name === "Platform") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Overview") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path
          d="M3 3.5h6.5V10H3V3.5Zm7.5 0H17V8h-6.5V3.5ZM3 11.5h6.5V17H3v-5.5Zm7.5 0H17V17h-6.5v-5.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (name === "Packages") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path
          d="M4 7.5 10 4.5l6 3v7L10 17.5 4 14.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M4 7.5 10 10.5 16 7.5M10 10.5V17" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "Businesses") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path d="M4 16.5V6.5L10 3.5l6 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 16.5v-4h4v4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "Quality") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path d="M3.5 13.5 7.5 9l2.5 2.5L16.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 5H16.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "Numbers") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <rect x="6" y="2.5" width="8" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
      <path
        d="M5 8.5a5 5 0 0 1 10 0c0 2.2-1.2 3.6-2.2 4.5-.5.4-.8.9-.8 1.5v.5H8v-.5c0-.6-.3-1.1-.8-1.5C6.2 12.1 5 10.7 5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8.5 16.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AdminLinkPending({
  href,
  setPendingHref,
}: {
  href: string;
  setPendingHref: (value: string | null | ((current: string | null) => string | null)) => void;
}) {
  const { pending } = useLinkStatus();
  useLayoutEffect(() => {
    if (pending) {
      setPendingHref(href);
      return;
    }
    setPendingHref((current) => (current === href ? null : current));
  }, [pending, href, setPendingHref]);
  return null;
}

function AdminDestinationLink({
  href,
  label,
  exact,
  pendingHref,
  setPendingHref,
  className,
  activeClassName,
  idleClassName,
  labelClassName,
  onRetap,
}: {
  href: string;
  label: string;
  exact: boolean;
  pendingHref: string | null;
  setPendingHref: (value: string | null | ((current: string | null) => string | null)) => void;
  className: string;
  activeClassName: string;
  idleClassName: string;
  labelClassName: string;
  onRetap?: () => void;
}) {
  const pathname = usePathname();
  const current = adminRouteActive(pathname, href, exact);
  const active = pendingHref ? pendingHref === href : current;

  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={(event) => {
        if (!onRetap || !current || pendingHref) return;
        if (!window.matchMedia("(max-width: 767px)").matches) return;
        event.preventDefault();
        onRetap();
      }}
      className={[className, deskShiftClass, focusRingVisible, active ? activeClassName : idleClassName].join(" ")}
    >
      <AdminLinkPending href={href} setPendingHref={setPendingHref} />
      <AdminIcon name={label} />
      <span className={labelClassName}>{label}</span>
    </Link>
  );
}

function useAdminPending() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);
  return { pendingHref, setPendingHref };
}

/** md+ icon rail. Same geometry as the owner desk. Own link list. Sign out lives in the account menu. */
export function AdminRail() {
  const { pendingHref, setPendingHref } = useAdminPending();

  return (
    <div
      data-admin-rail=""
      className="glass-chrome hidden h-full w-[5.5rem] shrink-0 flex-col border-r border-line/80 md:flex"
    >
      <div className="flex h-14 items-center justify-center">
        <DeskHint label="Scalers">
          <BrandLockup
            href="/admin"
            name="Scalers"
            size="sm"
            markOnly
            priority
            scroll={false}
            className="min-h-11 min-w-11 justify-center"
          />
        </DeskHint>
      </div>
      <nav aria-label="Super Admin" className="flex flex-1 flex-col items-center gap-1 px-1 pt-1">
        {ADMIN_LINKS.map((item) => (
          <AdminDestinationLink
            key={item.href}
            href={item.href}
            label={item.label}
            exact={item.exact}
            pendingHref={pendingHref}
            setPendingHref={setPendingHref}
            className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5"
            activeClassName="bg-accent/10 text-accent-deep"
            idleClassName="text-ink-soft hover:bg-surface-muted hover:text-ink"
            labelClassName="max-w-full truncate text-[10px] font-medium leading-none"
          />
        ))}
      </nav>
    </div>
  );
}

function retapAdminTab() {
  const well = document.querySelector("[data-admin-main]");
  if (well instanceof HTMLElement) well.scrollTop = 0;
  window.dispatchEvent(new Event(PHONE_TAB_REFRESH_EVENT));
}

/** Phone destinations. Hidden on a nested admin screen so the parent control owns the thumb zone. */
export function AdminTabBar() {
  const pathname = usePathname();
  const { pendingHref, setPendingHref } = useAdminPending();
  if (adminParentTarget(pathname)) return null;

  return (
    <nav
      data-admin-tabbar=""
      aria-label="Super Admin"
      className="glass-chrome fixed inset-x-0 bottom-0 z-50 isolate min-h-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px))] overflow-x-auto border-t border-line/80 pb-[env(safe-area-inset-bottom)] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max min-w-full">
        {ADMIN_LINKS.map((item) => (
          <li key={item.href} className="w-[4.5rem] shrink-0 overflow-visible">
            <AdminDestinationLink
              href={item.href}
              label={item.label}
              exact={item.exact}
              pendingHref={pendingHref}
              setPendingHref={setPendingHref}
              onRetap={retapAdminTab}
              className="flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 overflow-visible px-0.5 pt-1.5 text-[10px] leading-tight"
              activeClassName="font-semibold text-accent-deep"
              idleClassName="font-medium text-ink-soft"
              labelClassName="max-w-full whitespace-nowrap text-center"
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One control back to the parent admin list. The destination name is the accessible label. */
export function AdminNestedBack() {
  const pathname = usePathname();
  const parent = adminParentTarget(pathname);
  if (!parent) return null;

  return (
    <div className="mb-3">
      <DeskBack href={parent.href}>{parent.label}</DeskBack>
    </div>
  );
}

export function AdminShell({
  operatorName,
  children,
}: {
  operatorName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nested = Boolean(adminParentTarget(pathname));

  return (
    <div data-admin-shell="" data-admin-nested={nested ? "" : undefined} className={adminShellClass}>
      <AdminRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AdminAccountMenu name={operatorName} />
        <main data-admin-main="" data-pull-dirty-guard="" className={adminMainClass}>
          <AdminNestedBack />
          {children}
        </main>
        <AdminTabBar />
      </div>
    </div>
  );
}
