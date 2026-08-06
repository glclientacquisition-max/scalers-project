import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAuthenticated } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { normalizeVoiceLanguages } from "@/lib/languages";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenant = await getCurrentTenant();
  if (!tenant || tenant.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.business_name === "string") patch.business_name = body.business_name.trim();
  if (typeof body.whatsapp_notification_number === "string") {
    patch.whatsapp_notification_number = body.whatsapp_notification_number.trim();
  }
  if (typeof body.llm_system_prompt === "string") {
    patch.llm_system_prompt = body.llm_system_prompt;
  }
  if (body.voice_languages != null) {
    const langs = normalizeVoiceLanguages(body.voice_languages);
    patch.voice_languages = langs;
    if (langs.includes("other")) {
      const other = String(body.voice_language_other || "").trim();
      if (!other) {
        return NextResponse.json(
          { error: "Name the other Kenyan language you want supported." },
          { status: 400 }
        );
      }
      patch.voice_language_other = other;
    } else {
      patch.voice_language_other = null;
    }
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select(
      "id, business_name, whatsapp_notification_number, llm_system_prompt, voice_languages, voice_language_other"
    )
    .single();

  if (error) {
    if (/voice_language/i.test(error.message)) {
      // SQL not applied yet — save the non-language fields.
      const fallback: Record<string, unknown> = { ...patch };
      delete fallback.voice_languages;
      delete fallback.voice_language_other;
      const { data: legacy, error: legacyErr } = await supabase
        .from("tenants")
        .update(fallback)
        .eq("id", id)
        .select("id, business_name, whatsapp_notification_number, llm_system_prompt")
        .single();
      if (legacyErr) {
        return NextResponse.json({ error: legacyErr.message }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        tenant: legacy,
        warning:
          "Language columns missing — apply docs/supabase/voice_languages.sql to persist language choices.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tenant: data });
}
