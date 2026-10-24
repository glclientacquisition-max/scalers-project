import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { adminAuth } from "@/lib/admin-auth";
import { hostOnlyCookieOptions, hostnameOf, isAdminHostName } from "@/lib/adminHost";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { SIGNIN_COOKIE, UNLOCK_COOKIE } from "@/lib/ops/stepUpCore";
import { revokeGrant } from "@/lib/ops/stepUpStore";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { inviteTokenFromNext, safeNextPath } from "@/lib/authRedirect";

export async function POST(request: NextRequest) {
  try {
    await revokeGrant(request.cookies.get(UNLOCK_COOKIE)?.value);
  } catch {
    // Grant table unreachable: the cookie clear below still ends the Unlock on this device.
  }
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
  // Sign-in 2FA: forget this device (12 h trust) and any live Unlock. The device token is
  // stateless (signed, not stored), so clearing the cookie is the whole revoke.
  res.cookies.set(SIGNIN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(UNLOCK_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });

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
