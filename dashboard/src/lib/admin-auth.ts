import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { adminAccessCode } from "@/lib/admin-auth-plugin";
import { configuredAdminHost, configuredAppHost } from "@/lib/adminHost";

function adminAuthSecret(): string {
  return (
    process.env.BETTER_AUTH_SECRET ||
    process.env.DASHBOARD_SECRET ||
    process.env.ADMIN_ACCESS_CODE ||
    process.env.DASHBOARD_PASSWORD ||
    "dev-admin-secret"
  );
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
