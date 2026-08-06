import { cookies } from "next/headers";
import crypto from "crypto";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const COOKIE = "sauti_desk_session";

function expectedToken(): string {
  const password = process.env.DASHBOARD_PASSWORD || "";
  const secret = process.env.DASHBOARD_SECRET || password || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`ok:${password}`).digest("hex");
}

/** Shared-password cookie session (pre–Supabase Auth desk). */
export async function isLegacyAuthenticated(): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return process.env.DASHBOARD_OPEN === "true";
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken()));
  } catch {
    return false;
  }
}

export async function getAuthUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

/** True if Supabase Auth session OR legacy shared-password cookie is valid. */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getAuthUser();
  if (user) return true;
  return isLegacyAuthenticated();
}

export function sessionCookieValue(): string {
  return expectedToken();
}

export { COOKIE as SESSION_COOKIE };
