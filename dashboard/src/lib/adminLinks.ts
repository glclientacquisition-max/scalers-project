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
  /** No screen yet. Rendered as a quiet row with this line, never a dead link. None today. */
  pending?: string;
};

/**
 * Desktop rail: all eight, in this order. Phone: the four `tab` items plus More.
 * Quality opens traced call quality (#603).
 * Voices is the voice list. One settings-like screen today.
 */
export const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin", label: "Today", exact: true, phone: "tab" },
  { href: "/admin/businesses", label: "Businesses", exact: false, phone: "tab" },
  { href: "/admin/quality", label: "Quality", exact: false, phone: "tab" },
  { href: "/admin/billing", label: "Billing", exact: false, phone: "tab" },
  { href: "/admin/numbers", label: "Numbers", exact: false, phone: "more" },
  { href: "/admin/platform", label: "Platform", exact: false, phone: "more" },
  { href: "/admin/activity", label: "Activity", exact: false, phone: "more" },
  { href: "/admin/voices", label: "Voices", exact: false, phone: "more" },
];

/** Older screens still in use, filed under the destination that will absorb them. */
export const ADMIN_SECTIONS: readonly { href: string; label: string; parent: string }[] = [
  { href: "/admin/packages", label: "Plans", parent: "/admin/billing" },
  { href: "/admin/wallets", label: "Ledger", parent: "/admin/billing" },
];

/**
 * ADMIN_V2 nav, locked 23 Oct 2026 (t178u): six entries, one home per job.
 * Phone: Overview, Businesses, Billing, Numbers as tabs; Quality and Settings under More.
 */
export const ADMIN_LINKS_V2: readonly AdminLink[] = [
  { href: "/admin", label: "Overview", exact: true, phone: "tab" },
  { href: "/admin/businesses", label: "Businesses", exact: false, phone: "tab" },
  { href: "/admin/billing", label: "Billing", exact: false, phone: "tab" },
  { href: "/admin/numbers", label: "Numbers", exact: false, phone: "tab" },
  { href: "/admin/quality", label: "Quality", exact: false, phone: "more" },
  { href: "/admin/settings", label: "Settings", exact: false, phone: "more" },
];

export type AdminTab = { href: string; label: string };

/** Billing → tabs (ADMIN_V2). Collections joins with the Billing home slice. */
export const ADMIN_BILLING_TABS: readonly AdminTab[] = [
  { href: "/admin/billing/home", label: "Home" },
  { href: "/admin/billing/invoices", label: "Invoices" },
  { href: "/admin/billing/payments", label: "Payments" },
  { href: "/admin/billing/packages", label: "Packages" },
];

/** Settings → tabs (ADMIN_V2). Alerts, retention, payment switches and operators arrive with the hub slice. */
export const ADMIN_SETTINGS_TABS: readonly AdminTab[] = [
  { href: "/admin/settings/general", label: "General" },
  { href: "/admin/settings/services", label: "Services" },
  { href: "/admin/settings/voices", label: "Voices" },
  { href: "/admin/settings/audit", label: "Audit log" },
];

/**
 * Old route → ADMIN_V2 home. Pages redirect with this map when ADMIN_V2=on; null means the route stays.
 * Quality business pages fold into the Quality pane in the Quality slice.
 */
export function adminV2Redirect(pathname: string): string | null {
  const path = pathOnly(pathname);
  if (path === "/admin/billing") return "/admin/billing/home";
  if (path === "/admin/packages" || path === "/admin/billing/catalog") return "/admin/billing/packages";
  // Cut in v2: Ledger (and its KES credit view) folds into Billing home.
  if (path === "/admin/wallets") return "/admin/billing/home";
  if (path === "/admin/platform") return "/admin/settings/services";
  if (path === "/admin/voices") return "/admin/settings/voices";
  if (path === "/admin/activity") return "/admin/settings/audit";
  if (path === "/admin/settings") return "/admin/settings/general";
  const biz = /^\/admin\/businesses\/([^/]+)$/.exec(path);
  if (biz) return `/admin/businesses?pane=${encodeURIComponent(decodeURIComponent(biz[1]))}`;
  const bill = /^\/admin\/billing\/([^/]+)$/.exec(path);
  if (bill && !["home", "invoices", "payments", "packages", "catalog", "collections"].includes(bill[1])) {
    return `/admin/businesses?pane=${encodeURIComponent(decodeURIComponent(bill[1]))}&section=money`;
  }
  return null;
}

export function adminLinks(v2 = false): readonly AdminLink[] {
  return v2 ? ADMIN_LINKS_V2 : ADMIN_LINKS;
}

export const ADMIN_PHONE_TABS = ADMIN_LINKS.filter((item) => item.phone === "tab");
export const ADMIN_MORE_LINKS = ADMIN_LINKS.filter((item) => item.phone === "more");

/** Phone bar: four destinations, then More. */
export function adminPhoneTabs(v2 = false): AdminLink[] {
  return adminLinks(v2).filter((item) => item.phone === "tab");
}

/** The More sheet rows. */
export function adminPhoneMore(v2 = false): AdminLink[] {
  return adminLinks(v2).filter((item) => item.phone === "more");
}

export const adminShellClass =
  "admin-theme fixed inset-0 flex min-w-0 overflow-hidden bg-canvas text-ink pt-[env(safe-area-inset-top,0px)]";

export const adminMainClass =
  "mx-auto w-full min-h-0 min-w-0 max-w-desk flex-1 overflow-y-auto px-4 pt-4 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-6 md:p-6";

/** v2: no max-width, 16px margins at every width. */
export const adminMainV2Class =
  "flex w-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-[var(--desk-tabbar-clearance)] md:pb-4";

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
export function adminParentTarget(pathname: string, v2 = false): { href: string; label: string } | null {
  const path = pathOnly(pathname);
  if (path === "/admin") return null;
  // v2: section tabs (Billing, Settings) and panes carry the way back; no shell chevron on a tab.
  if (v2) {
    if (!path.startsWith("/admin/")) return null;
    if (/^\/admin\/(billing|settings)(\/[^/]+)?$/.test(path) || /^\/admin\/(businesses|numbers|quality)$/.test(path)) return null;
    if (path.startsWith("/admin/billing/invoices/")) return { href: "/admin/billing/invoices", label: "Invoices" };
    const top = ADMIN_LINKS_V2.filter((i) => i.href !== "/admin").find((i) => path.startsWith(`${i.href}/`));
    return top ? { href: top.href, label: top.label } : { href: "/admin", label: "Overview" };
  }

  for (const section of ADMIN_SECTIONS) {
    if (path === section.href || path.startsWith(`${section.href}/`)) {
      const parent = linkFor(section.parent);
      return parent ? { href: parent.href, label: parent.label } : { href: "/admin", label: "Today" };
    }
  }

  if (path.startsWith("/admin/billing/invoices/")) {
    return { href: "/admin/billing/invoices", label: "Invoices" };
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
