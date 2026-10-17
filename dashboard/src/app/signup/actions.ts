"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureTenantForUser } from "@/lib/tenant";
import { allowAll, clientIpFrom } from "@/lib/rateLimit";
import { requestOrigin, signupConfirmUrl } from "@/lib/authCallback";
import { isEmail, normalizePhone, phoneCountry, phoneHint } from "@/lib/setupFlow";
import { signupErrorMessage } from "@/lib/signupErrors";

export type SignupState = {
  error?: string;
  /** Which field the error belongs to, for focus and aria-invalid. */
  field?: "business_name" | "email" | "password" | "notification_phone";
  checkEmail?: boolean;
  email?: string;
  /** Show a "Sign in" link next to the error. */
  signIn?: boolean;
  values?: { business_name: string; email: string; notification_phone: string };
};

export type ResendState = { ok?: boolean; error?: string };

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const businessName = String(formData.get("business_name") || "").trim();
  const phoneRaw = String(formData.get("notification_phone") || "").trim();
  const values = { business_name: businessName, email, notification_phone: phoneRaw };

  if (!businessName) return { error: "Enter your business name.", field: "business_name", values };
  if (businessName.length > 120) return { error: "Use 120 characters or fewer.", field: "business_name", values };
  if (!isEmail(email)) return { error: "Enter a valid email address.", field: "email", values };
  if (password.length < 8) return { error: "Use at least 8 characters.", field: "password", values };
  if (password.length > 72) return { error: "Use 72 characters or fewer.", field: "password", values };
  const country = phoneCountry(formData.get("phone_country"));
  const notificationPhone = normalizePhone(phoneRaw, country);
  if (!notificationPhone) {
    return { error: phoneHint(country), field: "notification_phone", values };
  }

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n));
  const allowed = await allowAll([
    { bucket: `signup:ip:${ip}`, windowSeconds: 3600, max: 10 },
    { bucket: `signup:email:${email}`, windowSeconds: 3600, max: 3 },
  ]);
  if (!allowed) return { error: "Too many sign-up attempts. Wait a few minutes and try again.", values };

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: "Sign up is not available right now. Try again in a few minutes.", values };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { business_name: businessName, whatsapp_notification_number: notificationPhone },
      emailRedirectTo: signupConfirmUrl(requestOrigin((n) => h.get(n))),
    },
  });

  if (error) {
    const mapped = signupErrorMessage(error.message);
    return { error: mapped.message, field: mapped.field, signIn: mapped.signIn, values };
  }

  // Supabase hides existing accounts: it returns a user with no identities and sends nothing.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: "This email already has an account.", field: "email", signIn: true, values };
  }

  const userId = data.user?.id;
  if (!userId) return { error: "Sign-up didn't finish. Try again.", values };

  // Auth trigger is primary; this covers databases where it is missing. Idempotent.
  try {
    await ensureTenantForUser({ userId, businessName, notificationPhone });
  } catch (err) {
    // The account exists; setup offers "Create your workspace" after sign-in.
    console.error("[signup] ensureTenantForUser failed:", err instanceof Error ? err.message : err);
  }

  if (!data.session) return { checkEmail: true, email };
  redirect("/onboarding");
}

export async function resendConfirmationAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter the email you signed up with." };

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n));
  const allowed = await allowAll([
    { bucket: `resend:email:${email}`, windowSeconds: 60, max: 1 },
    { bucket: `resend:email-hour:${email}`, windowSeconds: 3600, max: 5 },
    { bucket: `resend:ip:${ip}`, windowSeconds: 3600, max: 20 },
  ]);
  if (!allowed) return { error: "Wait a minute before asking for another link." };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: signupConfirmUrl(requestOrigin((n) => h.get(n))) },
    });
    if (error) {
      const mapped = signupErrorMessage(error.message);
      return { error: mapped.message };
    }
  } catch {
    return { error: "Couldn't send the link. Try again in a few minutes." };
  }
  // Same answer whether or not the address has an account.
  return { ok: true };
}
