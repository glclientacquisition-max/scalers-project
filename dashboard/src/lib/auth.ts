import { cache } from "react";
import { cookies, headers } from "next/headers";
import crypto from "crypto";
import type { User } from "@supabase/supabase-js";
import { adminAuth } from "@/lib/admin-auth";
import { parseAdminOperators } from "@/lib/adminOperators";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const COOKIE = "scalers_session";
/** Previous product cookie name — still accepted during transition. */
const LEGACY_COOKIE = "sauti_desk_session";

function expectedToken(): string {
  const password = process.env.DASHBOARD_PASSWORD || "";
  const secret = process.env.DASHBOARD_SECRET || password || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`ok:${password}`).digest("hex");
}

function tokenMatches(token: string | undefined): boolean {
  if (!token) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken()));
  } catch {
    return false;
  }
}

export const getAdminSession = cache(async () => {
  try {
    return await adminAuth.api.getSession({ headers: await headers() });
  } catch {
    return null;
  }
});

/** Better Auth Super Admin session, or the leftover HMAC cookie. */
export const isAdminAuthenticated = cache(async (): Promise<boolean> => {
  const session = await getAdminSession();
  if (session?.user) return true;

  const jar = await cookies();
  if (tokenMatches(jar.get(COOKIE)?.value) || tokenMatches(jar.get(LEGACY_COOKIE)?.value)) {
    return true;
  }

  if (parseAdminOperators().length > 0) return false;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return process.env.DASHBOARD_OPEN === "true";
  return false;
});

/** Shared-password cookie session (ops / demo). */
export const isLegacyAuthenticated = isAdminAuthenticated;

/**
 * Full user from the Auth server (one network round trip). Use where fields that are not in
 * the JWT matter: email_confirmed_at, identities. Onboarding and sign-up use this.
 */
export const getVerifiedAuthUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
});

/**
 * Signed-in user for desk reads. The session JWT is verified locally against the project's
 * ES256 signing keys (JWKS is cached), so no Auth round trip per request. Falls back to
 * getUser when the claims cannot be verified (HS256 project, missing session, old SDK).
 * Database access still goes through RLS with the same JWT.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase.auth as unknown as {
      getClaims?: () => Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
    };
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims();
      const c = data?.claims;
      if (!error && c && typeof c.sub === "string" && c.sub && c.role === "authenticated") {
        return {
          id: c.sub,
          email: typeof c.email === "string" ? c.email : undefined,
          phone: typeof c.phone === "string" ? c.phone : undefined,
          aud: typeof c.aud === "string" ? c.aud : "authenticated",
          role: "authenticated",
          app_metadata: (c.app_metadata as User["app_metadata"]) || {},
          user_metadata: (c.user_metadata as User["user_metadata"]) || {},
          created_at: "",
        } as User;
      }
      if (!error && !c) return null;
    }
  } catch {
    /* fall through to the network check */
  }
  return getVerifiedAuthUser();
});

/** True if Supabase Auth session OR legacy shared-password cookie is valid. */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getAuthUser();
  if (user) return true;
  return isLegacyAuthenticated();
}

export function sessionCookieValue(): string {
  return expectedToken();
}

export { COOKIE as SESSION_COOKIE, LEGACY_COOKIE as LEGACY_SESSION_COOKIE };
