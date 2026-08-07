import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SESSION_COOKIE, sessionCookieValue } from "@/lib/auth";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");

  // Legacy shared-password desk (ops / demo) when email omitted or reserved.
  const legacyPassword = process.env.DASHBOARD_PASSWORD || "";
  if (
    legacyPassword &&
    password === legacyPassword &&
    (!email || email === "admin@scalers.local" || email === "admin@sauti.local")
  ) {
    // Platform operators go straight to the Super Admin console.
    const res = NextResponse.redirect(new URL("/admin", request.url), 303);
    res.cookies.set(SESSION_COOKIE, sessionCookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return res;
  }

  if (!email || !password) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  let url: string;
  let anonKey: string;
  try {
    url = getSupabaseUrl();
    anonKey = getSupabaseAnonKey();
  } catch {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Supabase Auth env vars are missing.")}`,
        request.url
      ),
      303
    );
  }

  const res = NextResponse.redirect(new URL("/calls", request.url), 303);

  const supabase = createServerClient(url, anonKey, {
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

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  return res;
}
