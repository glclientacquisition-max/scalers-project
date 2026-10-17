import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { adminAuth } from "@/lib/admin-auth";
import { hostOnlyCookieOptions, hostnameOf, isAdminHostName } from "@/lib/adminHost";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { inviteTokenFromNext, safeNextPath } from "@/lib/authRedirect";

export async function POST(request: NextRequest) {
  try {
    await adminAuth.api.signOut({ headers: request.headers });
  } catch {
    // Stateless cookie may already be gone.
  }

  // Only an invite page may be the post-logout destination ("Sign out and continue").
  let inviteNext: string | null = null;
  try {
    const form = await request.formData();
    const want = safeNextPath(form.get("next"), "");
    if (want && inviteTokenFromNext(want)) inviteNext = want;
  } catch {
    // No form body.
  }
  const nextPath = isAdminHostName(hostnameOf(request.headers.get("host")))
    ? "/admin/login"
    : inviteNext || "/login";
  const res = NextResponse.redirect(new URL(nextPath, request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(LEGACY_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(DESK_TENANT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, hostOnlyCookieOptions(options));
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
