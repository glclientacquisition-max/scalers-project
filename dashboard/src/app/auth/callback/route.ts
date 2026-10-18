import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { hostOnlyCookieOptions } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { callbackFailurePath, isResetNext, safeNext, staleSessionCookies } from "@/lib/authCallback";
import { RECOVERY_COOKIE, recoveryCookieOptions } from "@/lib/passwordReset";

const OTP_TYPES = new Set(["signup", "email", "magiclink", "email_change", "recovery"]);

/**
 * Signup confirmation landing. Handles PKCE (?code=) and token-hash (?token_hash=&type=) links,
 * sets the session cookie and continues to setup. If the link opened in another browser
 * (no PKCE verifier) the email is still confirmed, so we ask the person to sign in.
 * Password reset links come back here with next=/reset-password: success marks the session as a
 * recovery session for a few minutes, failure lands on the reset page's "send a new link" state.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const next = safeNext(sp.get("next"));
  const jar: Array<{ name: string; value: string; options: CookieOptions }> = [];
  let signedIn = false;

  const supabaseError = sp.get("error_code") || sp.get("error");
  if (!supabaseError) {
    try {
      const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (c: Array<{ name: string; value: string; options: CookieOptions }>) => {
            jar.push(...c);
          },
        },
      });
      const code = sp.get("code");
      const tokenHash = sp.get("token_hash");
      const type = String(sp.get("type") || "");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        signedIn = !error && Boolean(data.user);
      } else if (tokenHash && OTP_TYPES.has(type)) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
        signedIn = !error && Boolean(data.user);
      }
    } catch {
      signedIn = false;
    }
  }

  const dest = signedIn ? next : callbackFailurePath(supabaseError, next);
  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  for (const { name, value, options } of jar) res.cookies.set(name, value, hostOnlyCookieOptions(options));
  if (signedIn && isResetNext(next)) res.cookies.set(RECOVERY_COOKIE, "1", hostOnlyCookieOptions<CookieOptions>(recoveryCookieOptions));
  // Never leave someone in a different account than the one they just confirmed: on success drop
  // leftover chunks of the old session; on failure sign the old session out so /login shows the
  // "email confirmed, sign in" screen instead of bouncing into the previous account.
  const stale = staleSessionCookies(
    request.cookies.getAll().map((c) => c.name),
    jar.map((c) => c.name),
    signedIn
  );
  for (const name of stale) res.cookies.set(name, "", hostOnlyCookieOptions<CookieOptions>({ path: "/", maxAge: 0 }));
  return res;
}
