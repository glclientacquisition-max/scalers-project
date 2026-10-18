import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { adminLoginHref, hostOnlyCookieOptions } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { welcomeHomePath } from "@/lib/authRedirect";
import { loginNextPath } from "@/lib/shortCallLink";
import { createDeskTimer } from "@/lib/deskTiming";
import { acceptPendingInvitesForUser, DESK_TENANT_COOKIE, deskTenantCookieOptions } from "@/lib/inviteAccept";

export async function POST(request: NextRequest) {
  // Sign-in timing (preview 18 Oct: first submit to /home took 17.2s, later 1.8s).
  const timer = createDeskTimer();
  const form = await request.formData();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");
  // Only short call links (/c/<code>); anything else lands on /home as before.
  const next = loginNextPath(form.get("next"));
  const failed = (to: string) =>
    NextResponse.redirect(new URL(next ? `${to}&next=${encodeURIComponent(next)}` : to, request.url), 303);

  if (email === "admin@scalers.local" || email === "admin@sauti.local") {
    return NextResponse.redirect(
      new URL(adminLoginHref(process.env, request.headers.get("host")), request.url),
      303
    );
  }

  if (!email || !password) {
    return failed("/login?error=1");
  }

  let url: string;
  let anonKey: string;
  try {
    url = getSupabaseUrl();
    anonKey = getSupabaseAnonKey();
  } catch {
    return failed("/login?error=config");
  }

  const res = NextResponse.redirect(new URL(next || "/home", request.url), 303);

  const supabase = createServerClient(url, anonKey, {
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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  timer.mark("auth");
  if (error) {
    console.info(timer.line("login") + " result=denied");
    return failed("/login?error=1");
  }

  // Invited people who confirmed on another device land here: finish their invite.
  if (data.user) {
    const joined = await acceptPendingInvitesForUser(data.user).catch(() => null);
    if (joined && joined.ok) {
      res.headers.set("Location", new URL(welcomeHomePath(joined.businessName), request.url).toString());
      res.cookies.set(DESK_TENANT_COOKIE, joined.tenantId, deskTenantCookieOptions);
    }
  }
  timer.mark("invites");
  console.info(timer.line("login") + " result=ok");

  return res;
}
