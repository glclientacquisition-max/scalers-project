/**
 * Super Admin destinations. Separate from the owner desk link list.
 * Do not import the owner nav module from here.
 */

export type AdminLink = {
  href: string;
  label: string;
  exact: boolean;
};

export const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/platform", label: "Platform", exact: false },
  { href: "/admin/packages", label: "Packages", exact: false },
  { href: "/admin/businesses", label: "Businesses", exact: false },
  { href: "/admin/quality", label: "Quality", exact: false },
  { href: "/admin/numbers", label: "Numbers", exact: false },
  { href: "/admin/voices", label: "Voices", exact: false },
];

/** Phone bar. Seven labels do not fit at 360 without clipping, so the rest live under More. */
const PHONE_TAB_HREFS = ["/admin", "/admin/businesses", "/admin/quality", "/admin/numbers"] as const;

export function adminPhoneTabs(): AdminLink[] {
  const byHref = new Map(ADMIN_LINKS.map((item) => [item.href, item]));
  return PHONE_TAB_HREFS.map((href) => {
    const item = byHref.get(href);
    if (!item) throw new Error(`Missing admin phone tab ${href}`);
    return item;
  });
}

export function adminPhoneMore(): AdminLink[] {
  const shown = new Set<string>(PHONE_TAB_HREFS);
  return ADMIN_LINKS.filter((item) => !shown.has(item.href));
}

export const adminShellClass =
  "admin-theme fixed inset-0 flex min-w-0 overflow-hidden bg-canvas text-ink pt-[env(safe-area-inset-top,0px)]";

export const adminMainClass =
  "mx-auto w-full min-h-0 min-w-0 max-w-desk flex-1 overflow-y-auto px-4 pt-4 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-6 md:p-6";

function pathOnly(pathname: string) {
  const bare = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return bare;
}

/** List root for a nested admin path. Null on a destination itself. Label is the parent list, never a generic back word. */
export function adminParentTarget(pathname: string): { href: string; label: string } | null {
  const path = pathOnly(pathname);
  if (path === "/admin") return null;

  const ranked = ADMIN_LINKS.filter((item) => item.href !== "/admin").toSorted(
    (a, b) => b.href.length - a.href.length,
  );
  for (const item of ranked) {
    if (path === item.href) return null;
    if (path.startsWith(`${item.href}/`)) return { href: item.href, label: item.label };
  }
  if (path.startsWith("/admin/")) return { href: "/admin", label: "Overview" };
  return null;
}

export function adminRouteActive(pathname: string, href: string, exact: boolean) {
  const path = pathOnly(pathname);
  if (exact) return path === href;
  return path === href || path.startsWith(`${href}/`);
}
