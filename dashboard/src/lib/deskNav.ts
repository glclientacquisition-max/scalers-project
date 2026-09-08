export const DESK_NAV_LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/requests", label: "Requests" },
  { href: "/appointments", label: "Appointments" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
] as const;

export type DeskNavHref = (typeof DESK_NAV_LINKS)[number]["href"];

export const DESK_MOBILE_PRIMARY = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/requests", label: "Requests" },
] as const;

export const DESK_MOBILE_MORE = [
  { href: "/appointments", label: "Appointments" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
] as const;

export function isDeskHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isDeskMoreActive(pathname: string): boolean {
  return DESK_MOBILE_MORE.some((item) => isDeskHrefActive(pathname, item.href));
}

export function deskNavLabelForPath(pathname: string): string | null {
  const match = DESK_NAV_LINKS.find((item) => isDeskHrefActive(pathname, item.href));
  return match ? match.label : null;
}
