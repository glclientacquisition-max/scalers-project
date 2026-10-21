import { isUsableWavBytes, NO_VOICE_SAMPLE_COPY } from "@/lib/previewAudio";
import { getVoicePublicBase } from "@/lib/sautikit";
import {
  listCuratedSonioxVoices,
  resolveLiveCallVoiceId,
} from "@/lib/sonioxVoiceCatalog";

export type TtsPreviewResult = {
  wav: Buffer;
  spokenText?: string;
  language?: string;
  voiceId?: string;
  /** Greeting previews: "cache" when the line used the stored greeting audio, "tts" when synthesized. */
  greetingSource?: "cache" | "tts";
  /** Greeting previews: the greeting line the voice server built (before pronunciation). */
  greetingText?: string;
};

/** Preview requests give up after this long so the Test button never hangs. */
export const VOICE_PREVIEW_TIMEOUT_MS = 15_000;

/** Owner-facing copy when the voice server is slow or unreachable. No infra names. */
export const VOICE_PREVIEW_UNREACHABLE_COPY =
  "Could not play the sample right now. Try again in a minute.";

/**
 * Server-only: synthesize the desk phone preview on the voice line (same path as live calls).
 */
export async function fetchTtsPreviewWav(opts: {
  text: string;
  lexicon?: unknown;
  language?: string;
  voiceId?: string | null;
  /**
   * Greeting preview: send the raw greeting and let the voice line say it the
   * way callers hear it (Voice contract: ?greeting=1&tenant_id=<id>). Desk no
   * longer rewrites the line itself; the spoken text comes back in X-Spoken-Text.
   */
  greeting?: { tenantId: string } | null;
}): Promise<TtsPreviewResult> {
  const text = String(opts.text || "").trim();
  if (!text) {
    throw new Error("Preview text is required.");
  }

  const base = getVoicePublicBase();
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  const catalog = await listCuratedSonioxVoices();
  const voiceId = resolveLiveCallVoiceId(opts.voiceId, catalog);
  let url: string;
  try {
    url = new URL("/api/tts/preview", `${base}/`).toString();
  } catch {
    throw new Error(
      `Invalid VOICE_PUBLIC_BASE_URL (${base}). Use https://your-railway-host with no path.`
    );
  }

  const started = performance.now();
  const tenantId = String(opts.greeting?.tenantId || "").trim();
  const greetingUrl = tenantId
    ? (() => {
        const u = new URL(url);
        u.searchParams.set("greeting", "1");
        u.searchParams.set("tenant_id", tenantId);
        return u.toString();
      })()
    : null;

  // One 15s budget for the whole preview, fallback included.
  const signal = AbortSignal.timeout(VOICE_PREVIEW_TIMEOUT_MS);
  const post = (target: string) =>
    fetch(target, {
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
        voiceId,
        ...(target === greetingUrl && tenantId ? { tenant_id: tenantId } : {}),
      }),
      cache: "no-store",
      signal,
    });

  let res: Response;
  let mode = greetingUrl ? "greeting" : "text";
  try {
    res = await post(greetingUrl || url);
    // Voice contract (#747): 400 = missing/bad tenant_id, 404 = unknown tenant.
    // A line without greeting support ignores the param and reads `text` (200).
    // On 400/404 still play something: a plain read of the Desk greeting text.
    if (greetingUrl && (res.status === 400 || res.status === 404)) {
      console.warn(`[tts-preview] greeting=1 refused (${res.status}); falling back to a plain read`);
      mode = "text-fallback";
      res = await post(url);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `desk-timing route=tts-preview mode=${mode} failed;dur=${Math.round(performance.now() - started)} (${detail})`
    );
    throw new Error(VOICE_PREVIEW_UNREACHABLE_COPY);
  }
  console.info(
    `desk-timing route=tts-preview mode=${mode} status=${res.status} total;dur=${Math.round(performance.now() - started)}`
  );

  if (res.status === 401) {
    console.warn("[tts-preview] voice line rejected the internal secret (401)");
    throw new Error(VOICE_PREVIEW_UNREACHABLE_COPY);
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
  if (!isUsableWavBytes(wav)) {
    throw new Error(NO_VOICE_SAMPLE_COPY);
  }
  const spokenHeader = res.headers.get("x-spoken-text");
  const language = res.headers.get("x-tts-language") || undefined;
  const spokenVoiceId = res.headers.get("x-soniox-voice") || undefined;
  if (
    voiceId &&
    spokenVoiceId &&
    spokenVoiceId.toLowerCase() !== voiceId.toLowerCase()
  ) {
    throw new Error("Preview used a different voice than this line.");
  }
  let spokenText: string | undefined;
  if (spokenHeader) {
    try {
      spokenText = decodeURIComponent(spokenHeader);
    } catch {
      spokenText = spokenHeader;
    }
  }

  const decodeHeader = (raw: string | null) => {
    if (!raw) return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const greetingText = decodeHeader(res.headers.get("x-greeting-text"));
  const sourceHeader = String(res.headers.get("x-greeting-source") || "").toLowerCase();
  const greetingSource =
    sourceHeader === "cache" || sourceHeader === "tts" ? sourceHeader : undefined;

  return { wav, spokenText, language, voiceId: spokenVoiceId || voiceId, greetingSource, greetingText };
}
