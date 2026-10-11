import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { hostOnlyCookieOptions } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { callbackFailurePath, safeNext } from "@/lib/authCallback";

const OTP_TYPES = new Set(["signup", "email", "magiclink", "email_change"]);

/**
 * Signup confirmation landing. Handles PKCE (?code=) and token-hash (?token_hash=&type=) links,
 * sets the session cookie and continues to setup. If the link opened in another browser
 * (no PKCE verifier) the email is still confirmed, so we ask the person to sign in.
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

  const dest = signedIn ? next : callbackFailurePath(supabaseError);
  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  for (const { name, value, options } of jar) res.cookies.set(name, value, hostOnlyCookieOptions(options));
  return res;
}
