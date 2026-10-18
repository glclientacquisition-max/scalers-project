import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { fetchTtsPreviewWav, VOICE_PREVIEW_UNREACHABLE_COPY } from "@/lib/voicePreview";
import { NO_VOICE_SAMPLE_COPY } from "@/lib/previewAudio";
import { getCurrentTenant } from "@/lib/tenant";
import { currentMemberRole, memberDenied } from "@/lib/requireMember";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Sign in to preview pronunciation." }, {
      status: 401,
    });
  }

  // Voice previews spend TTS credit and live in Settings: settings access required.
  if (!(await currentMemberRole())) {
    return NextResponse.json({ error: "Open your business workspace to preview pronunciation." }, { status: 403 });
  }
  const denied = await memberDenied("settings.view");
  if (denied) return NextResponse.json({ error: denied.error }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text || text.length > 500) {
    return NextResponse.json(
      { error: "Preview text required (max 500 characters)." },
      { status: 400 }
    );
  }

  // Greeting previews: the voice line says the raw greeting exactly as callers
  // hear it. The tenant comes from the session, never from the request body.
  let greeting: { tenantId: string } | null = null;
  if (body.greeting === true) {
    const tenant = await getCurrentTenant();
    if (tenant?.id) greeting = { tenantId: tenant.id };
  }

  try {
    const result = await fetchTtsPreviewWav({
      text,
      lexicon: body.lexicon,
      language: body.language,
      voiceId: body.voiceId ?? body.soniox_voice_id ?? null,
      greeting,
    });
    const headers = new Headers({
      "Content-Type": "audio/wav",
      "Content-Disposition": 'inline; filename="preview.wav"',
      "Cache-Control": "no-store",
    });
    if (result.spokenText) {
      headers.set("X-Spoken-Text", encodeURIComponent(result.spokenText));
    }
    if (result.language) {
      headers.set("X-Tts-Language", result.language);
    }
    if (result.voiceId) {
      headers.set("X-Soniox-Voice", result.voiceId);
    }
    if (result.greetingSource) {
      headers.set("X-Greeting-Source", result.greetingSource);
    }
    if (result.greetingText) {
      headers.set("X-Greeting-Text", encodeURIComponent(result.greetingText));
    }
    return new NextResponse(new Uint8Array(result.wav), { status: 200, headers });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const ownerSafe = [VOICE_PREVIEW_UNREACHABLE_COPY, NO_VOICE_SAMPLE_COPY, "Preview used a different voice than this line."];
    if (!ownerSafe.includes(raw)) console.warn("[pronunciation-preview] failed:", raw);
    const message = ownerSafe.includes(raw) ? raw : VOICE_PREVIEW_UNREACHABLE_COPY;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
