import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { adminLoginHref } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");

  if (email === "admin@scalers.local" || email === "admin@sauti.local") {
    return NextResponse.redirect(
      new URL(adminLoginHref(process.env, request.headers.get("host")), request.url),
      303
    );
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
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }

  const res = NextResponse.redirect(new URL("/home", request.url), 303);

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
