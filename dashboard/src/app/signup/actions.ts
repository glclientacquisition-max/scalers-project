"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureTenantForUser } from "@/lib/tenant";
import { normalizeVoiceLanguages } from "@/lib/languages";

export type SignupState = {
  error?: string;
  checkEmail?: boolean;
};

function normalizeKenyaPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+254${digits.slice(1)}`;
  if (digits.length >= 9) return `+254${digits}`;
  return null;
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const businessName = String(formData.get("business_name") || "").trim();
  const notificationRaw = String(formData.get("notification_phone") || "").trim();
  const notificationPhone = normalizeKenyaPhone(notificationRaw);
  const voiceLanguages = normalizeVoiceLanguages(formData.getAll("voice_languages"));
  const voiceLanguageOther = String(formData.get("voice_language_other") || "").trim();

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
  if (voiceLanguages.includes("other") && !voiceLanguageOther) {
    return { error: "Name the other Kenyan language you want supported." };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return {
      error:
        "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        business_name: businessName,
        whatsapp_notification_number: notificationPhone,
        voice_languages: voiceLanguages,
        voice_language_other: voiceLanguageOther || null,
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

  // Auth trigger is primary; this fallback covers projects before SQL is applied.
  try {
    await ensureTenantForUser({
      userId,
      businessName,
      notificationPhone,
      voiceLanguages,
      voiceLanguageOther,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signup] ensureTenantForUser failed:", message);
    return {
      error: `Account created, but tenant setup failed: ${message}. Apply docs/supabase/multi_tenant_onboarding.sql and docs/supabase/voice_languages.sql then retry sign-in.`,
    };
  }

  // Email confirmation required — no session yet.
  if (!data.session) {
    return { checkEmail: true };
  }

  redirect("/calls");
}
