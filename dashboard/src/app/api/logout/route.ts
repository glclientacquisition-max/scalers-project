import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

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
