import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { fetchTtsPreviewWav } from "@/lib/voicePreview";

/** Max spoken chars for desk phone preview (brand intro can include a short offering). */
const PREVIEW_TEXT_MAX = 700;

/**
 * NextResponse + Node Buffer has been observed on Vercel to serialize as a
 * JSON object ({"0":82,"1":73,...}) instead of raw bytes — browsers then fail
 * with "no supported source". Force a plain ArrayBuffer-backed Blob body.
 */
function wavResponse(
  wav: Buffer | Uint8Array,
  headers: Headers
): NextResponse {
  const src =
    wav instanceof Uint8Array
      ? wav
      : new Uint8Array(wav as ArrayBufferLike);
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  return new NextResponse(new Blob([copy], { type: "audio/wav" }), {
    status: 200,
    headers,
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Sign in to preview pronunciation." }, {
      status: 401,
    });
  }

  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text || text.length > PREVIEW_TEXT_MAX) {
    return NextResponse.json(
      {
        error: `Preview text required (max ${PREVIEW_TEXT_MAX} characters).`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await fetchTtsPreviewWav({
      text,
      lexicon: body.lexicon,
      language: body.language,
      voiceId: body.voiceId ?? body.soniox_voice_id ?? null,
    });
    const headers = new Headers({
      "Content-Type": "audio/wav",
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
    return wavResponse(result.wav, headers);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not generate phone preview.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
