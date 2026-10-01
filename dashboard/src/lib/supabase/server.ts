import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hostOnlyCookieOptions } from "@/lib/adminHost";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/** Cookie-backed Supabase client for Server Components / Server Actions. */
export const createSupabaseServerClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, hostOnlyCookieOptions(options));
          });
        } catch {
          // Called from a Server Component that cannot set cookies — safe to ignore
          // when a Route Handler / Server Action already established the session.
        }
      },
    },
  });
});
