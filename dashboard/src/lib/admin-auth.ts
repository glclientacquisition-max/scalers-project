import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { adminAccessCode } from "@/lib/admin-auth-plugin";
import { configuredAdminHost, configuredAppHost, configuredSiteHost } from "@/lib/adminHost";

/** Production must set a dedicated signing secret, not an access code or shared desk password. */
export function isAdminAuthProperlyConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET || process.env.DASHBOARD_SECRET);
}

function adminAuthSecret(): string {
  const preferred = process.env.BETTER_AUTH_SECRET || process.env.DASHBOARD_SECRET;
  if (preferred) return preferred;
  if (process.env.NODE_ENV !== "production") {
    return process.env.ADMIN_ACCESS_CODE || process.env.DASHBOARD_PASSWORD || "dev-admin-secret";
  }
  // Build and misconfigured prod: sessions fail closed; do not sign with door codes.
  return "unconfigured-super-admin-auth";
}

function adminAuthBaseURL(): string {
  const host = configuredAdminHost();
  if (host) return `https://${host}`;
  return process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

export const adminAuth = betterAuth({
  secret: adminAuthSecret(),
  baseURL: adminAuthBaseURL(),
  appName: "Scalers Super Admin",
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 14,
      strategy: "jwe",
      refreshCache: true,
    },
  },
  account: {
    storeStateStrategy: "cookie",
    storeAccountCookie: true,
  },
  advanced: {
    cookiePrefix: "admin",
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  trustedOrigins: async (request) => {
    const origins = new Set<string>([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      `https://${configuredAppHost()}`,
      `https://${configuredSiteHost()}`,
    ]);
    const adminHost = configuredAdminHost();
    if (adminHost) origins.add(`https://${adminHost}`);
    if (request) {
      try {
        origins.add(new URL(request.url).origin);
      } catch {
        /* ignore */
      }
      const headerOrigin = request.headers.get("origin");
      if (headerOrigin) origins.add(headerOrigin);
    }
    return [...origins];
  },
  plugins: [adminAccessCode(), nextCookies()],
});
