"use server";

import { isAuthenticated } from "@/lib/auth";
import { deriveLexiconFromRecording } from "@/lib/pronunciationFromRecording";
import {
  lexiconForStorage,
  mergeLexiconEntries,
  parseTtsLexicon,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import { screenPronunciationSuggestions } from "@/lib/pronunciationScreen";
import {
  parseSuggestionList,
  suggestPronunciations,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type ConfirmPronunciationState = {
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
  entry?: TtsLexiconEntry;
  entries?: TtsLexiconEntry[];
  lexicon?: TtsLexiconEntry[];
  heard?: string;
};

export type ScreenPronunciationState = {
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
  suggestions?: PronunciationSuggestion[];
};

const MAX_AUDIO_BYTES = 1_800_000; // ~1.8 MB — sentences are a bit longer
const MAX_PROMPT = 200;

function asBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

function parseTargetsField(raw: FormDataEntryValue | null): Array<{
  label: string;
  match: string;
}> {
  if (raw == null) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = String((item as { label?: string }).label || "").trim();
        const match = String((item as { match?: string }).match || "").trim();
        if (!label) return null;
        return { label, match };
      })
      .filter(Boolean) as Array<{ label: string; match: string }>;
  } catch {
    return [];
  }
}

/**
 * AI-screen constructive pronunciation lines for this workspace profile.
 */
export async function screenPronunciationSuggestionsAction(
  _prev: ScreenPronunciationState,
  formData: FormData
): Promise<ScreenPronunciationState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to refresh suggestions." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const input = {
    businessName: String(formData.get("business_name") || "").trim(),
    agentName: String(formData.get("agent_name") || "").trim(),
    locationNotes: String(formData.get("location_notes") || "").trim(),
    locations: (() => {
      try {
        const raw = JSON.parse(String(formData.get("locations") || "[]"));
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })(),
    team: (() => {
      try {
        const raw = JSON.parse(String(formData.get("team") || "[]"));
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })(),
    services: (() => {
      try {
        const raw = JSON.parse(String(formData.get("services") || "[]"));
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })(),
    faqs: (() => {
      try {
        const raw = JSON.parse(String(formData.get("faqs") || "[]"));
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })(),
    bulletinTexts: (() => {
      try {
        const raw = JSON.parse(String(formData.get("bulletin_texts") || "[]"));
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })(),
    existingLexicon: parseTtsLexicon(formData.get("current_lexicon")),
  };

  try {
    const result = await screenPronunciationSuggestions(input);
    return {
      ok: true,
      source: result.source,
      suggestions: result.suggestions,
    };
  } catch (err) {
    const local = suggestPronunciations(input);
    return {
      ok: true,
      source: "local",
      suggestions: local.length ? local : parseSuggestionList([]),
      error:
        err instanceof Error
          ? `AI screen unavailable — showing basic lines. ${err.message}`
          : undefined,
    };
  }
}

/**
 * Accept an owner recording for one constructive line.
 * Verifies the audio matches the asked sentence, then merges target lexicon entries.
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
  const kindRaw = String(formData.get("kind") || "sentence").trim();
  const kind = kindRaw === "word" ? "word" : "sentence";
  const suggestedMatch = String(formData.get("match") || "").trim();
  const targets = parseTargetsField(formData.get("targets"));

  if (!prompt || prompt.length > MAX_PROMPT) {
    return { error: "Pick a short sentence to record." };
  }

  const audio = formData.get("audio");
  let audioBase64: string | null = null;
  let audioMimeType: string | null = null;

  if (audio && typeof audio === "object" && "arrayBuffer" in audio) {
    const file = audio as File;
    if (file.size > 0) {
      if (file.size > MAX_AUDIO_BYTES) {
        return {
          error: "Recording is too long. Keep it to one clear sentence.",
        };
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
    return { error: "Record yourself saying the line, then tap Keep." };
  }

  let derived: Awaited<ReturnType<typeof deriveLexiconFromRecording>>;
  try {
    derived = await deriveLexiconFromRecording({
      prompt,
      label,
      kind,
      suggestedMatch,
      targets,
      audioBase64,
      audioMimeType,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not learn that pronunciation.",
    };
  }

  if (!derived.ok) {
    return {
      error: derived.error,
      heard: derived.heard,
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
  const merged = mergeLexiconEntries(base, derived.entries);
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
    entry: derived.entries[0],
    entries: derived.entries,
    lexicon: merged,
    heard: derived.heard,
  };
}
