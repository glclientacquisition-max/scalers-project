"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureTenantForUser } from "@/lib/tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOpenSignupEnabled } from "@/lib/signupMode";
import { normalizeKenyaPhone } from "@/lib/kenyaPhone";
import {
  isHoneypotSubmission,
  parseAccessRequestForm,
} from "@/lib/accessRequestLogic";
import { rateLimitAccessRequest } from "@/lib/accessRequestRateLimit";
import { notifyOwnerOfAccessRequest } from "@/lib/accessRequestNotify";

export type SignupState = {
  error?: string;
  checkEmail?: boolean;
  submitted?: boolean;
};

function clientKeyFromHeaders(headerStore: Headers): string {
  return (
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerStore.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function requestAccessAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const parsed = parseAccessRequestForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  if (isHoneypotSubmission(parsed.fields)) {
    return { submitted: true };
  }

  const headerStore = await headers();
  if (rateLimitAccessRequest(clientKeyFromHeaders(headerStore))) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { error: "Request access is not available. Try again later." };
  }

  const { fields } = parsed;

  const { data: existing } = await admin
    .from("access_requests")
    .select("id")
    .eq("email", fields.email)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return { submitted: true };
  }

  const { error } = await admin.from("access_requests").insert({
    name: fields.name,
    business: fields.business,
    phone: fields.phone,
    email: fields.email,
    about: fields.about,
    status: "pending",
  });

  if (error) {
    if (/access_requests/i.test(error.message)) {
      console.error("[requestAccess] table missing:", error.message);
      return { error: "Request access is not available. Try again later." };
    }
    console.error("[requestAccess] insert failed:", error.message);
    return { error: "Could not save your request. Try again later." };
  }

  void notifyOwnerOfAccessRequest(fields).catch((err) => {
    console.error("[requestAccess] notify failed:", err);
  });

  return { submitted: true };
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  if (!isOpenSignupEnabled()) {
    return { error: "Self sign-up is closed. Request access instead." };
  }

  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const businessName = String(formData.get("business_name") || "").trim();
  const notificationRaw = String(formData.get("notification_phone") || "").trim();
  const notificationPhone = normalizeKenyaPhone(notificationRaw);

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!businessName) {
    return { error: "Business name is required." };
  }
  if (!notificationPhone) {
    return { error: "Enter a valid Kenyan phone number (e.g. +2547…)." };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: "Sign up is not available. Try again later." };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        business_name: businessName,
        whatsapp_notification_number: notificationPhone,
      },
      emailRedirectTo: undefined,
    },
  });

  if (error) {
    return { error: error.message };
  }

  const userId = data.user?.id;
  if (!userId) {
    return { error: "Signup succeeded but no user was returned. Try signing in." };
  }

  try {
    await ensureTenantForUser({
      userId,
      businessName,
      notificationPhone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signup] ensureTenantForUser failed:", message);
    return {
      error: "Account created, but workspace setup failed. Sign in to retry.",
    };
  }

  if (!data.session) {
    return { checkEmail: true };
  }

  redirect("/onboarding");
}
