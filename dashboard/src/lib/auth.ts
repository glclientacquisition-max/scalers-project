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

export const getAuthUser = cache(async (): Promise<User | null> => {
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
