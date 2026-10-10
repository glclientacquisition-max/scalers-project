/**
 * Super Admin destinations. Separate from the owner desk link list.
 * Do not import the owner nav module from here.
 */

export type AdminLink = {
  href: string;
  label: string;
  exact: boolean;
  /** Phone: one of the bottom tabs, or a row in the More sheet. */
  phone: "tab" | "more";
  /** No screen yet. Rendered as a quiet row with this line, never a dead link. */
  pending?: string;
};

/**
 * Desktop rail: all eight, in this order. Phone: the four `tab` items plus More.
 * Calls opens the call quality screens (#603) until the Calls list (A6) absorbs them.
 * Settings opens Voices, the one settings screen today.
 */
export const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin", label: "Today", exact: true, phone: "tab" },
  { href: "/admin/businesses", label: "Businesses", exact: false, phone: "tab" },
  { href: "/admin/quality", label: "Calls", exact: false, phone: "tab" },
  { href: "/admin/billing", label: "Billing", exact: false, phone: "tab" },
  { href: "/admin/numbers", label: "Numbers", exact: false, phone: "more" },
  { href: "/admin/platform", label: "Platform", exact: false, phone: "more" },
  {
    href: "/admin/activity",
    label: "Activity",
    exact: false,
    phone: "more",
    pending: "Not built yet. Admin actions are recorded from now on.",
  },
  { href: "/admin/voices", label: "Settings", exact: false, phone: "more" },
];

/** Older screens still in use, filed under the destination that will absorb them. */
export const ADMIN_SECTIONS: readonly { href: string; label: string; parent: string }[] = [
  { href: "/admin/packages", label: "Packages", parent: "/admin/billing" },
  { href: "/admin/wallets", label: "Ledger", parent: "/admin/billing" },
];

export const ADMIN_PHONE_TABS = ADMIN_LINKS.filter((item) => item.phone === "tab");
export const ADMIN_MORE_LINKS = ADMIN_LINKS.filter((item) => item.phone === "more");

/** Phone bar: four destinations, then More. */
export function adminPhoneTabs(): AdminLink[] {
  return [...ADMIN_PHONE_TABS];
}

/** The More sheet rows. */
export function adminPhoneMore(): AdminLink[] {
  return [...ADMIN_MORE_LINKS];
}

export const adminShellClass =
  "admin-theme fixed inset-0 flex min-w-0 overflow-hidden bg-canvas text-ink pt-[env(safe-area-inset-top,0px)]";

export const adminMainClass =
  "mx-auto w-full min-h-0 min-w-0 max-w-desk flex-1 overflow-y-auto px-4 pt-4 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-6 md:p-6";

function pathOnly(pathname: string) {
  const bare = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return bare;
}

function linkFor(href: string): AdminLink | undefined {
  return ADMIN_LINKS.find((item) => item.href === href);
}

/** Quality nested screens carry a breadcrumb, so the shell chevron stays off. Phone tabs still hide. */
export function adminHidesShellBack(pathname: string): boolean {
  return pathOnly(pathname).startsWith("/admin/quality/");
}

/** List root for a nested admin path. Null on a destination itself. Label is the parent list, never a generic back word. */
export function adminParentTarget(pathname: string): { href: string; label: string } | null {
  const path = pathOnly(pathname);
  if (path === "/admin") return null;

  for (const section of ADMIN_SECTIONS) {
    if (path === section.href || path.startsWith(`${section.href}/`)) {
      const parent = linkFor(section.parent);
      return parent ? { href: parent.href, label: parent.label } : { href: "/admin", label: "Today" };
    }
  }

  const ranked = ADMIN_LINKS.filter((item) => item.href.startsWith("/admin/") && !item.pending).toSorted(
    (a, b) => b.href.length - a.href.length,
  );
  for (const item of ranked) {
    if (path === item.href) return null;
    if (path.startsWith(`${item.href}/`)) return { href: item.href, label: item.label };
  }
  if (path.startsWith("/admin/")) return { href: "/admin", label: "Today" };
  return null;
}

export function adminRouteActive(pathname: string, href: string, exact: boolean) {
  const path = pathOnly(pathname);
  if (href.includes("#")) return false;
  if (exact) return path === href;
  if (path === href || path.startsWith(`${href}/`)) return true;
  return ADMIN_SECTIONS.some(
    (section) => section.parent === href && (path === section.href || path.startsWith(`${section.href}/`)),
  );
}

/** More is lit when the current screen belongs to one of its rows. */
export function adminMoreActive(pathname: string) {
  return ADMIN_MORE_LINKS.some((item) => !item.pending && adminRouteActive(pathname, item.href, item.exact));
}
