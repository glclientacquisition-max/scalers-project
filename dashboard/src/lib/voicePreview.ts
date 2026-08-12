import { getVoicePublicBase } from "@/lib/sautikit";

export type TtsPreviewResult = {
  wav: Buffer;
  spokenText?: string;
  language?: string;
  voiceId?: string;
};

/**
 * Server-only: synthesize desk phone preview via Railway voice engine (same Soniox path as live calls).
 */
export async function fetchTtsPreviewWav(opts: {
  text: string;
  lexicon?: unknown;
  language?: string;
  voiceId?: string | null;
}): Promise<TtsPreviewResult> {
  const text = String(opts.text || "").trim();
  if (!text) {
    throw new Error("Preview text is required.");
  }

  const base = getVoicePublicBase();
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  let url: string;
  try {
    url = new URL("/api/tts/preview", `${base}/`).toString();
  } catch {
    throw new Error(
      `Invalid VOICE_PUBLIC_BASE_URL (${base}). Use https://your-railway-host with no path.`
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-voice-internal-secret": secret } : {}),
      },
      body: JSON.stringify({
        text,
        lexicon: opts.lexicon,
        language: opts.language,
        callLanguage: opts.language || "en",
        voiceId: opts.voiceId,
      }),
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach voice engine at ${base}. Check VOICE_PUBLIC_BASE_URL on Vercel. (${detail})`
    );
  }

  if (res.status === 401) {
    throw new Error(
      "Voice preview unauthorized. Set the same VOICE_INTERNAL_SECRET on Vercel and Railway, then redeploy."
    );
  }

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const msg =
      errJson && typeof errJson.error === "string"
        ? errJson.error
        : `Voice preview failed (${res.status})`;
    throw new Error(msg);
  }

  const wav = Buffer.from(await res.arrayBuffer());
  const spokenHeader = res.headers.get("x-spoken-text");
  const language = res.headers.get("x-tts-language") || undefined;
  const voiceId = res.headers.get("x-soniox-voice") || undefined;
  let spokenText: string | undefined;
  if (spokenHeader) {
    try {
      spokenText = decodeURIComponent(spokenHeader);
    } catch {
      spokenText = spokenHeader;
    }
  }

  return { wav, spokenText, language, voiceId };
}
