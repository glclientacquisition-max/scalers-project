import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { hostOnlyCookieOptions } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { inviteTokenFromNext, safeNextPath, welcomeHomePath } from "@/lib/authRedirect";
import { acceptByToken, acceptPendingInvitesForUser, DESK_TENANT_COOKIE, deskTenantCookieOptions } from "@/lib/inviteAccept";

const OTP_TYPES = new Set(["signup", "email", "invite", "magiclink", "recovery", "email_change"]);

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/**
 * Email confirmation landing. Handles PKCE (?code=) and token-hash (?token_hash=&type=) links,
 * sets the session cookie, finishes a pending invite, then sends the person on.
 * If the link opened in another browser (no PKCE verifier), the email is still confirmed:
 * we send them back to `next` with confirmed=1 so the invite page asks them to sign in.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const next = safeNextPath(sp.get("next"));
  const inviteToken = inviteTokenFromNext(next);
  const cookieJar: Array<{ name: string; value: string; options: CookieOptions }> = [];

  let userId: string | null = null;
  let email: string | null = null;
  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (c: Array<{ name: string; value: string; options: CookieOptions }>) => {
          cookieJar.push(...c);
        },
      },
    });
    const code = sp.get("code");
    const tokenHash = sp.get("token_hash");
    const type = String(sp.get("type") || "");
    if (code) {
      const { data } = await supabase.auth.exchangeCodeForSession(code);
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
    } else if (tokenHash && OTP_TYPES.has(type)) {
      const { data } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
    }
  } catch {
    userId = null;
  }

  let dest: string;
  let tenantCookie: string | null = null;
  if (!userId) {
    dest = withParam(inviteToken ? next : "/login", "confirmed", "1");
  } else {
    const joined = inviteToken
      ? await acceptByToken(inviteToken, userId)
      : await acceptPendingInvitesForUser({ id: userId, email });
    if (joined && joined.ok) {
      tenantCookie = joined.tenantId;
      dest = welcomeHomePath(joined.businessName);
    } else {
      dest = next;
    }
  }

  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  for (const { name, value, options } of cookieJar) res.cookies.set(name, value, hostOnlyCookieOptions(options));
  if (tenantCookie) res.cookies.set(DESK_TENANT_COOKIE, tenantCookie, deskTenantCookieOptions);
  return res;
}
