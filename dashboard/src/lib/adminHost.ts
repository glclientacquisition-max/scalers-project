export const DEFAULT_ADMIN_HOST = "admin.scalers.co.ke";

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
  try {
    return new URL(env.NEXT_PUBLIC_SITE_URL || "https://scalers.co.ke").host;
  } catch {
    return "scalers.co.ke";
  }
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
