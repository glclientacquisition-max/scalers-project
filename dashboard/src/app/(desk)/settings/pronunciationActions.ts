"use server";

import { isAuthenticated } from "@/lib/auth";
import { normalizeAudioMimeForGemini } from "@/lib/gemini";
import { deriveLexiconFromRecording } from "@/lib/pronunciationFromRecording";
import {
  isBlockedMatch,
  lexiconForStorage,
  matchPatternFromPhrase,
  mergeLexiconEntries,
  mergeLexiconEntry,
  parseTtsLexicon,
  sanitizeSayForm,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  collectKnownPronunciationHints,
  mineSuggestionsFromAgentLines,
} from "@/lib/pronunciationMine";
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
      audioMimeType = normalizeAudioMimeForGemini(mime);
      audioBase64 = asBase64(await file.arrayBuffer());
    }
  }

  if (!audioBase64) {
    return {
      error: "Record yourself saying the line, then tap Use this take.",
    };
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
  // Always re-parse so blocked common-word matches cannot persist.
  const sanitized = parseTtsLexicon(merged);
  const stored = lexiconForStorage(sanitized);

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
    entry: sanitized[0] || derived.entries[0],
    entries: sanitized.filter((e) =>
      derived.entries.some(
        (d) => d.match.toLowerCase() === e.match.toLowerCase()
      )
    ),
    lexicon: sanitized,
    heard: derived.heard,
  };
}

/**
 * Persist the current lexicon array (e.g. after owner removes a bad entry).
 * Keep already saves on record confirm; this is for Remove without re-recording.
 */
export async function persistPronunciationLexicon(
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

  const stored = lexiconForStorage(parseTtsLexicon(formData.get("tts_lexicon")));
  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

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
    return { error: error.message };
  }

  return {
    ok: true,
    lexicon: parseTtsLexicon(stored),
    source: "local",
  };
}

export type MinePronunciationState = {
  error?: string;
  ok?: boolean;
  suggestions?: PronunciationSuggestion[];
  scannedLines?: number;
};

/**
 * Scan recent agent transcripts for hard names that may need pronunciation training.
 */
export async function minePronunciationFromCallsAction(
  _prev: MinePronunciationState,
  formData: FormData
): Promise<MinePronunciationState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to scan calls." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { data: calls, error: callErr } = await workspace.client
    .from("calls")
    .select("id")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(12);

  if (callErr) {
    return { error: callErr.message };
  }

  const callIds = (calls || []).map((c) => c.id).filter(Boolean);
  if (!callIds.length) {
    return { ok: true, suggestions: [], scannedLines: 0 };
  }

  const { data: transcripts, error: txErr } = await workspace.client
    .from("transcripts")
    .select("text_content, speaker, call_id")
    .in("call_id", callIds)
    .eq("speaker", "agent")
    .limit(200);

  if (txErr) {
    return { error: txErr.message };
  }

  const lines = (transcripts || [])
    .map((t) => String(t.text_content || "").trim())
    .filter(Boolean);

  const existing = parseTtsLexicon(
    formData.get("current_lexicon") ??
      (tenant as { tts_lexicon?: unknown }).tts_lexicon
  );

  const teamRaw = (tenant as { team_directory?: unknown }).team_directory;
  const team = Array.isArray(teamRaw)
    ? teamRaw.map((m) =>
        m && typeof m === "object"
          ? { name: String((m as { name?: string }).name || "") }
          : { name: String(m || "") }
      )
    : [];
  const locRaw = (tenant as { business_locations?: unknown }).business_locations;
  const locations = Array.isArray(locRaw)
    ? locRaw.map((l) => {
        const row = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
        return {
          label: String(row.label || ""),
          address: String(row.address || ""),
          landmark: String(row.landmark || ""),
        };
      })
    : [];

  const knownHints = collectKnownPronunciationHints({
    businessName: String(
      (tenant as { business_name?: string }).business_name || ""
    ),
    agentName: String((tenant as { agent_name?: string }).agent_name || ""),
    team,
    locations,
  });

  const suggestions = mineSuggestionsFromAgentLines({
    lines,
    existingLexicon: existing,
    knownHints,
    limit: 8,
  });

  return {
    ok: true,
    suggestions,
    scannedLines: lines.length,
  };
}

/**
 * Quick-add a typed phrase into the lexicon (optional say-as) without recording.
 * Prefer recording for quality; this is for fast fixes the owner heard wrong.
 */
export async function quickAddPronunciationAction(
  _prev: ConfirmPronunciationState,
  formData: FormData
): Promise<ConfirmPronunciationState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to add pronunciation." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const phrase = String(formData.get("phrase") || "").trim();
  const sayRaw = String(formData.get("say") || "").trim();
  if (!phrase || phrase.length > 80) {
    return { error: "Enter a short word or name (under 80 characters)." };
  }
  if (!sayRaw) {
    return {
      error:
        "Add how it should sound (e.g. Moo-in-dee Mbeen-goo), or use Queue to record instead.",
    };
  }

  const match = matchPatternFromPhrase(phrase);
  if (!match || isBlockedMatch(match)) {
    return {
      error:
        "That looks like a common English word. Train only hard names/places (or use a full phrase).",
    };
  }

  const say = sanitizeSayForm(sayRaw);
  if (!say) {
    return { error: "Could not build a spoken form for that phrase." };
  }

  const entry: TtsLexiconEntry = {
    match,
    say,
    langs: ["en", "sw", "sheng"],
    priority: 200,
    label: phrase.slice(0, 120),
  };

  const existing = parseTtsLexicon(
    (tenant as { tts_lexicon?: unknown }).tts_lexicon
  );
  const clientLexicon = parseTtsLexicon(formData.get("current_lexicon"));
  const base = clientLexicon.length ? clientLexicon : existing;
  const merged = parseTtsLexicon(mergeLexiconEntry(base, entry));
  const stored = lexiconForStorage(merged);

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { error } = await workspace.client
    .from("tenants")
    .update({ tts_lexicon: stored })
    .eq("id", tenant.id);

  if (error) {
    return { error: error.message };
  }

  return {
    ok: true,
    entry: merged.find((e) => e.match === match) || entry,
    entries: [entry],
    lexicon: merged,
    source: "local",
  };
}
