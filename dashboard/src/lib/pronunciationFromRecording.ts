/**
 * Verify owner recording matches the asked line, then derive lexicon say-as entries.
 * Guardrail: if they were asked for "sugar" but said "water", reject.
 */

import { generateGeminiMultimodal } from "@/lib/gemini";
import {
  localSayFallback,
  matchPatternFromPhrase,
  TTS_SAY_MAX,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import type { PronunciationTarget } from "@/lib/pronunciationSuggest";

const SYSTEM = `You check a Kenyan business owner's pronunciation training recording for Scalers (phone TTS).

They were asked to say a specific sentence clearly. Audio is attached.

Return ONLY valid JSON (no markdown):
{
  "match_ok": true,
  "heard": "short transcript of what they said",
  "reason": "if match_ok is false, one short owner-facing reason",
  "entries": [
    { "label": "Hard Name", "match": "optional-regex", "say": "How TTS should say it" }
  ]
}

match_ok rules (strict):
- true only if the recording is clearly an attempt at the TARGET sentence (same meaning / same key names)
- false if they said something totally different (e.g. asked for sugar, said water), stayed silent, hummed, or only said unrelated words
- Accent, pacing, and imperfect English are OK — still match_ok true if the right names/line are there
- Light filler ("um", "okay") around the line is OK

entries rules (only when match_ok true):
- One entry per TARGET hard name listed (not every English word)
- "say" = Latin letters Soniox TTS can read on a phone; hyphens for hard syllables (e.g. "Moo-een-dee Mbeen-goo")
- Prefer the owner's pronunciation when audible
- Max ${TTS_SAY_MAX} chars per say
- No IPA, no quotes inside strings`;

function extractJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function normalizeForCompare(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cheap overlap check when Gemini is unavailable — still block obvious mismatches. */
export function localAudioLikelyMatches(opts: {
  prompt: string;
  heard: string;
  targets?: PronunciationTarget[];
}): boolean {
  const heard = normalizeForCompare(opts.heard);
  if (!heard || heard.length < 2) return false;
  const prompt = normalizeForCompare(opts.prompt);
  if (!prompt) return false;

  // Whole-line token overlap
  const promptTokens = prompt.split(" ").filter((t) => t.length > 2);
  const heardSet = new Set(heard.split(" "));
  const overlap = promptTokens.filter((t) => heardSet.has(t)).length;
  if (promptTokens.length && overlap / promptTokens.length >= 0.45) {
    return true;
  }

  // At least one hard target must appear (normalized)
  const targets = opts.targets || [];
  if (targets.length) {
    const heardCompact = heard.replace(/\s+/g, "");
    return targets.some((t) => {
      const label = normalizeForCompare(t.label).replace(/\s+/g, "");
      return label.length >= 3 && heardCompact.includes(label);
    });
  }

  return false;
}

export type DeriveRecordingResult =
  | {
      ok: true;
      entries: TtsLexiconEntry[];
      source: "gemini" | "local";
      heard?: string;
    }
  | {
      ok: false;
      error: string;
      heard?: string;
    };

export async function deriveLexiconFromRecording(opts: {
  prompt: string;
  label?: string;
  kind?: "word" | "sentence";
  suggestedMatch?: string;
  targets?: PronunciationTarget[];
  audioBase64?: string | null;
  audioMimeType?: string | null;
}): Promise<DeriveRecordingResult> {
  const prompt = String(opts.prompt || "").trim();
  if (!prompt) {
    return { ok: false, error: "Nothing to pronounce." };
  }

  const targets: PronunciationTarget[] =
    Array.isArray(opts.targets) && opts.targets.length
      ? opts.targets
      : [
          {
            label: String(opts.label || prompt).trim(),
            match:
              String(opts.suggestedMatch || "").trim() ||
              matchPatternFromPhrase(opts.label || prompt),
          },
        ];

  if (!opts.audioBase64) {
    return {
      ok: false,
      error: "Record yourself saying the line, then tap Keep.",
    };
  }

  const userText = [
    `TARGET sentence (must match): ${prompt}`,
    `Hard targets to learn: ${JSON.stringify(targets.map((t) => t.label))}`,
    opts.label ? `Line title: ${opts.label}` : "",
    "Listen to the attached audio. Enforce match_ok strictly if content differs.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: userText }];

    if (opts.audioMimeType) {
      parts.push({
        inlineData: {
          mimeType: opts.audioMimeType,
          data: opts.audioBase64,
        },
      });
    }

    const raw = await generateGeminiMultimodal({
      systemInstruction: SYSTEM,
      parts,
      temperature: 0.15,
      maxOutputTokens: 512,
      timeoutMs: 22_000,
    });

    const json = extractJsonObject(raw);
    const heard = String(json.heard || "").trim();
    const matchOk = json.match_ok === true || json.matchOk === true;

    if (!matchOk) {
      const reason = String(json.reason || "").trim();
      return {
        ok: false,
        heard,
        error:
          reason ||
          `That didn’t sound like the line we asked for. Please say: “${prompt}”`,
      };
    }

    const rawEntries = Array.isArray(json.entries) ? json.entries : [];
    const entries: TtsLexiconEntry[] = [];

    for (const item of rawEntries) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = String(row.label || "").trim();
      const say = String(row.say || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, TTS_SAY_MAX);
      if (!label || !say) continue;
      const suggested = targets.find(
        (t) => t.label.toLowerCase() === label.toLowerCase()
      );
      const match =
        String(row.match || "").trim() ||
        suggested?.match ||
        matchPatternFromPhrase(label);
      if (!match) continue;
      entries.push({
        match,
        say,
        langs: ["en", "sw", "sheng"],
        priority: 200,
        label: label.slice(0, 120),
        kind: "sentence",
      });
    }

    // Ensure every target gets an entry even if model omitted some
    for (const target of targets) {
      const has = entries.some(
        (e) =>
          e.label?.toLowerCase() === target.label.toLowerCase() ||
          e.match.toLowerCase() === target.match.toLowerCase()
      );
      if (!has) {
        entries.push({
          match: target.match,
          say: localSayFallback(target.label),
          langs: ["en", "sw", "sheng"],
          priority: 200,
          label: target.label,
          kind: "sentence",
        });
      }
    }

    if (!entries.length) {
      return {
        ok: false,
        heard,
        error: "Couldn’t learn pronunciations from that take. Please try again.",
      };
    }

    return { ok: true, entries, source: "gemini", heard };
  } catch {
    // Without multimodal we cannot safely accept arbitrary audio.
    return {
      ok: false,
      error:
        "Couldn’t verify your recording right now. Please try Keep again in a moment.",
    };
  }
}
