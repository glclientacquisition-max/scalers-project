import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { adminAuth } from "@/lib/admin-auth";
import { hostnameOf, isAdminHostName } from "@/lib/adminHost";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function POST(request: NextRequest) {
  try {
    await adminAuth.api.signOut({ headers: request.headers });
  } catch {
    // Stateless cookie may already be gone.
  }

  const nextPath = isAdminHostName(hostnameOf(request.headers.get("host")))
    ? "/admin/login"
    : "/login";
  const res = NextResponse.redirect(new URL(nextPath, request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(LEGACY_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    });
    await supabase.auth.signOut();
  } catch {
    // Env may be unset in legacy-only deploys — cookie clear above is enough.
  }

  return res;
}
