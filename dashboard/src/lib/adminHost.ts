export const DEFAULT_ADMIN_HOST = "admin.scalers.co.ke";
export const DEFAULT_APP_HOST = "app.scalers.co.ke";
export const DEFAULT_SITE_HOST = "www.scalers.co.ke";

/** Owner desk routes. Marketing stays on the site host. */
const DESK_ROOTS = [
  "/login",
  "/signup",
  "/onboarding",
  "/home",
  "/calls",
  "/contacts",
  "/wallet",
  "/requests",
  "/appointments",
  "/settings",
  "/dev",
  "/api/login",
  "/api/logout",
  "/api/tenant",
  "/api/voices",
  "/api/pronunciation",
];

function stripHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

/** Set `ADMIN_HOST` to enable the admin subdomain split. Unset keeps `/admin` on the app host. */
export function configuredAdminHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.ADMIN_HOST || env.NEXT_PUBLIC_ADMIN_HOST || "").trim();
  if (!raw) return null;
  const host = stripHost(raw);
  return host || null;
}

export function configuredAppHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.APP_HOST || env.NEXT_PUBLIC_APP_HOST || "").trim();
  if (raw) return stripHost(raw);
  return configuredSiteHost(env);
}

/** Marketing host. Stays on the apex when APP_HOST is the desk subdomain. */
export function configuredSiteHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.SITE_HOST || env.NEXT_PUBLIC_SITE_URL || `https://${DEFAULT_SITE_HOST}`).trim();
  if (!raw) return DEFAULT_SITE_HOST;
  try {
    if (raw.includes("://")) return new URL(raw).host;
  } catch {
    /* host string */
  }
  return stripHost(raw) || DEFAULT_SITE_HOST;
}

function bareHost(host: string): string {
  return host.replace(/^www\./, "");
}

/** True when the owner desk host is different from the marketing host. */
export function appHostSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const app = configuredAppHost(env);
  const site = configuredSiteHost(env);
  return Boolean(app && site && app !== site);
}

export function isSiteHostName(
  hostname: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const host = hostnameOf(hostname);
  const site = configuredSiteHost(env);
  return bareHost(host) === bareHost(site);
}

export function isAppHostName(
  hostname: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return hostnameOf(hostname) === configuredAppHost(env);
}

export function isDeskPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return DESK_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

export type AppHostRedirect = { host: string; pathname: string };

/**
 * Desk paths on the marketing host go to the app host.
 * The app host root is sign-in, not the marketing page.
 * Unset or equal hosts leave the request alone (local, staging, preview).
 */
export function appHostRedirect(
  hostname: string,
  pathname: string,
  env: NodeJS.ProcessEnv = process.env
): AppHostRedirect | null {
  if (!appHostSplitEnabled(env)) return null;
  const host = hostnameOf(hostname);
  if (isLoopbackHost(host) || isAdminHostName(host, env)) return null;
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const app = configuredAppHost(env);
  if (isSiteHostName(host, env) && isDeskPath(path)) {
    return { host: app, pathname: path };
  }
  if (isAppHostName(host, env) && path === "/") {
    return { host: app, pathname: "/login" };
  }
  return null;
}

/** Wordmark and "Scalers home" on the desk point at marketing when the hosts are split. */
export function marketingHomeHref(env: NodeJS.ProcessEnv = process.env): string {
  if (!appHostSplitEnabled(env)) return "/";
  return `https://${configuredSiteHost(env)}/`;
}

/**
 * Marketing -> app entry links (/login, /signup, /home). When hosts are split these
 * must be absolute and rendered as plain <a>: a relative next/link prefetches
 * /login with the 'rsc' header on the site host, gets a 308 to the app host, and
 * the browser blocks that cross-origin redirect (CORS errors in the console).
 */
export function appEntryHref(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!appHostSplitEnabled(env)) return clean;
  return `https://${configuredAppHost(env)}${clean}`;
}

/** Supabase email confirmation lands on the desk host. */
export function ownerAuthRedirectUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!appHostSplitEnabled(env)) return undefined;
  return `https://${configuredAppHost(env)}/login`;
}

/** Auth cookies stay on the host that set them. Never Domain=.scalers.co.ke. */
export function hostOnlyCookieOptions<T extends { domain?: string }>(options: T): Omit<T, "domain"> {
  const next = { ...options };
  delete next.domain;
  return next;
}

export function hostnameOf(hostHeader: string | null | undefined): string {
  return String(hostHeader || "").split(":")[0].toLowerCase();
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isAdminHostName(
  hostname: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const adminHost = configuredAdminHost(env);
  return Boolean(adminHost && hostname === adminHost);
}

export function adminLoginHref(
  env: NodeJS.ProcessEnv = process.env,
  requestHost?: string | null
): string {
  const adminHost = configuredAdminHost(env);
  const hostname = hostnameOf(requestHost);
  if (adminHost && !isLoopbackHost(hostname) && hostname !== adminHost) {
    return `https://${adminHost}/admin/login`;
  }
  return "/admin/login";
}

export function isAdminHostAllowedPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/brand")) return true;
  if (pathname === "/favicon.ico" || pathname === "/og.png") return true;
  if (pathname === "/" || pathname === "/login") return true;
  if (pathname.startsWith("/admin")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/admin")) return true;
  if (pathname.startsWith("/api/did-pool")) return true;
  if (pathname.startsWith("/api/logout")) return true;
  return false;
}
