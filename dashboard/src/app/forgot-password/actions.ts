"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { allowAll, clientIpFrom } from "@/lib/rateLimit";
import { requestOrigin, resetPasswordRedirectUrl } from "@/lib/authCallback";
import { isEmail } from "@/lib/setupFlow";

export type ForgotState = { sent?: boolean; email?: string; error?: string };

/**
 * Sends a reset link. Always gives the same answer whether or not the address has an account,
 * so the page never tells anyone who is signed up.
 */
export async function requestPasswordResetAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter the email you sign in with.", email };

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n));
  const allowed = await allowAll([
    { bucket: `reset:email:${email}`, windowSeconds: 60, max: 1 },
    { bucket: `reset:email-hour:${email}`, windowSeconds: 3600, max: 5 },
    { bucket: `reset:ip:${ip}`, windowSeconds: 3600, max: 20 },
  ]);
  if (!allowed) return { error: "Wait a minute before asking for another link.", email };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetPasswordRedirectUrl(requestOrigin((n) => h.get(n))),
    });
    if (error) {
      if (/rate limit|too many|security purposes/i.test(error.message)) {
        return { error: "Wait a minute before asking for another link.", email };
      }
      console.error("[forgot-password] resetPasswordForEmail:", error.message);
    }
  } catch (err) {
    console.error("[forgot-password]", err instanceof Error ? err.message : err);
  }
  return { sent: true, email };
}
