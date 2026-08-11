"use server";

import { isAuthenticated } from "@/lib/auth";
import { deriveLexiconFromRecording } from "@/lib/pronunciationFromRecording";
import {
  lexiconForStorage,
  mergeLexiconEntry,
  parseTtsLexicon,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type ConfirmPronunciationState = {
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
  entry?: TtsLexiconEntry;
  lexicon?: TtsLexiconEntry[];
};

const MAX_AUDIO_BYTES = 1_500_000; // ~1.5 MB webm

function asBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

/**
 * Accept an owner recording for one suggested phrase, derive say-as, merge into tts_lexicon.
 */
export async function confirmPronunciationRecording(
  _prev: ConfirmPronunciationState,
  formData: FormData
): Promise<ConfirmPronunciationState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save pronunciation." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const prompt = String(formData.get("prompt") || "").trim();
  const label = String(formData.get("label") || "").trim() || prompt;
  const kindRaw = String(formData.get("kind") || "word").trim();
  const kind = kindRaw === "sentence" ? "sentence" : "word";
  const suggestedMatch = String(formData.get("match") || "").trim();

  if (!prompt || prompt.length > 160) {
    return { error: "Pick a short word or sentence to record." };
  }

  const audio = formData.get("audio");
  let audioBase64: string | null = null;
  let audioMimeType: string | null = null;

  if (audio && typeof audio === "object" && "arrayBuffer" in audio) {
    const file = audio as File;
    if (file.size > 0) {
      if (file.size > MAX_AUDIO_BYTES) {
        return { error: "Recording is too long. Try a shorter take (a few seconds)." };
      }
      const mime = String(file.type || "audio/webm").toLowerCase();
      if (!mime.startsWith("audio/") && mime !== "application/octet-stream") {
        return { error: "Upload an audio recording." };
      }
      audioMimeType = mime.startsWith("audio/") ? mime : "audio/webm";
      audioBase64 = asBase64(await file.arrayBuffer());
    }
  }

  if (!audioBase64) {
    return { error: "Record yourself saying the phrase, then tap Keep." };
  }

  let derived: { entry: TtsLexiconEntry; source: "gemini" | "local" };
  try {
    derived = await deriveLexiconFromRecording({
      prompt,
      label,
      kind,
      suggestedMatch,
      audioBase64,
      audioMimeType,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not learn that pronunciation.",
    };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const existing = parseTtsLexicon(
    (tenant as { tts_lexicon?: unknown }).tts_lexicon
  );
  const clientLexicon = parseTtsLexicon(formData.get("current_lexicon"));
  const base = clientLexicon.length ? clientLexicon : existing;
  const merged = mergeLexiconEntry(base, derived.entry);
  const stored = lexiconForStorage(merged);

  const { error } = await workspace.client
    .from("tenants")
    .update({ tts_lexicon: stored })
    .eq("id", tenant.id);

  if (error) {
    if (/tts_lexicon/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/tts_lexicon.sql in Supabase.`,
      };
    }
    if (/row-level security|permission denied|rls/i.test(error.message)) {
      return {
        error:
          "Couldn’t save pronunciation for this workspace. Refresh and try again — if it keeps failing, support needs to grant owner update on tts_lexicon.",
      };
    }
    return { error: error.message };
  }

  return {
    ok: true,
    source: derived.source,
    entry: derived.entry,
    lexicon: merged,
  };
}
