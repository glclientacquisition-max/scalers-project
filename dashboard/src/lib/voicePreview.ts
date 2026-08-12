import { getVoicePublicBase } from "@/lib/sautikit";

export type TtsPreviewResult = {
  wav: Buffer;
  spokenText?: string;
  language?: string;
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

  const base = getVoicePublicBase().replace(/\/+$/, "");
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();

  const res = await fetch(`${base}/api/tts/preview`, {
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
  let spokenText: string | undefined;
  if (spokenHeader) {
    try {
      spokenText = decodeURIComponent(spokenHeader);
    } catch {
      spokenText = spokenHeader;
    }
  }

  return { wav, spokenText, language };
}
