/**
 * Edge gate for Super Admin pages. Pure: no Next or Node imports, so the proxy and tests share it.
 *
 * This is the cheap first check: no admin cookie at all means no render.
 * The real check (session or HMAC cookie is valid) is requireSuperAdmin() on the server.
 */

export const ADMIN_LOGIN_PATH = "/admin/login";

/** Cookie names that can carry a Super Admin session. */
const ADMIN_COOKIE_RE = /^(__Secure-)?admin\.session_(token|data)$/;
const LEGACY_ADMIN_COOKIES = new Set(["scalers_session", "sauti_desk_session"]);

/** Admin console pages, not the login screen or its assets. */
export function isGuardedAdminPath(pathname: string): boolean {
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
  if (pathname === ADMIN_LOGIN_PATH || pathname.startsWith(`${ADMIN_LOGIN_PATH}/`)) return false;
  return true;
}

/** Admin pages and the admin JSON routes. Both must never be cached by a shared cache. */
export function isNoStoreAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/did-pool")
  );
}

export function hasAdminSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (ADMIN_COOKIE_RE.test(name) || LEGACY_ADMIN_COOKIES.has(name)) return true;
  }
  return false;
}

/**
 * Where a request for `pathname` must go before any page code runs, or null to let it through.
 * `openMode` mirrors DASHBOARD_OPEN=true local dev, where the server check decides alone.
 */
export function adminGateRedirect(
  pathname: string,
  cookieNames: Iterable<string>,
  openMode = false
): string | null {
  if (openMode) return null;
  if (!isGuardedAdminPath(pathname)) return null;
  if (hasAdminSessionCookie(cookieNames)) return null;
  return ADMIN_LOGIN_PATH;
}

/** Response header for every admin page and admin JSON route. */
export const ADMIN_CACHE_CONTROL = "private, no-store, no-cache, max-age=0, must-revalidate";
