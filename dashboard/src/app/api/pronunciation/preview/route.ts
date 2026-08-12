import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { fetchTtsPreviewWav } from "@/lib/voicePreview";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Sign in to preview pronunciation." }, {
      status: 401,
    });
  }

  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text || text.length > 500) {
    return NextResponse.json(
      { error: "Preview text required (max 500 characters)." },
      { status: 400 }
    );
  }

  try {
    const result = await fetchTtsPreviewWav({
      text,
      lexicon: body.lexicon,
      language: body.language,
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
    return new NextResponse(new Uint8Array(result.wav), { status: 200, headers });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not generate phone preview.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
