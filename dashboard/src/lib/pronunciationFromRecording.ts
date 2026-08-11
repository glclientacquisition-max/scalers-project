/**
 * Derive a Soniox-friendly "say" spelling from an owner recording (+ target phrase).
 */

import { generateGeminiMultimodal } from "@/lib/gemini";
import {
  localSayFallback,
  matchPatternFromPhrase,
  TTS_SAY_MAX,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";

const SYSTEM = `You write pronunciation hints for a Kenyan phone receptionist TTS (Soniox).

The owner recorded themselves saying a word or short sentence clearly.
Return ONLY valid JSON (no markdown):
{"say":"how the TTS should speak it","match":"optional regex-ish match if different"}

Rules for "say":
- Write the spoken form in Latin letters that an English/Kiswahili TTS will read clearly on a phone
- Prefer syllable-friendly spelling with hyphens for hard names (e.g. "Moo-een-dee Mbeen-goo")
- Keep brand spacing natural when clear ("Chapter One", "M-Pesa")
- Do NOT invent different meanings — only fix pronunciation
- Max ${TTS_SAY_MAX} characters
- No IPA symbols, no quotes inside the string, no explanation fields

If audio is missing or unclear, still propose the best Kenyan-English / Kiswahili-friendly spelling for the target text.`;

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

export async function deriveLexiconFromRecording(opts: {
  prompt: string;
  label?: string;
  kind?: "word" | "sentence";
  suggestedMatch?: string;
  audioBase64?: string | null;
  audioMimeType?: string | null;
}): Promise<{ entry: TtsLexiconEntry; source: "gemini" | "local" }> {
  const prompt = String(opts.prompt || "").trim();
  if (!prompt) {
    throw new Error("Nothing to pronounce.");
  }

  const match =
    String(opts.suggestedMatch || "").trim() ||
    matchPatternFromPhrase(opts.label || prompt);

  const fallbackSay = localSayFallback(opts.label || prompt);
  const base: TtsLexiconEntry = {
    match,
    say: fallbackSay,
    langs: ["en", "sw", "sheng"],
    priority: 200,
    label: (opts.label || prompt).slice(0, 120),
    kind: opts.kind === "sentence" ? "sentence" : "word",
  };

  const userText = [
    `Target text the receptionist must say: ${prompt}`,
    opts.label && opts.label !== prompt ? `Short label: ${opts.label}` : "",
    opts.kind ? `Kind: ${opts.kind}` : "",
    opts.suggestedMatch ? `Preferred match pattern: ${opts.suggestedMatch}` : "",
    opts.audioBase64
      ? "Audio: owner recording of this phrase is attached. Prefer their pronunciation."
      : "No audio attached — propose the clearest phone spelling.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: userText }];

    if (opts.audioBase64 && opts.audioMimeType) {
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
      temperature: 0.2,
      maxOutputTokens: 256,
      timeoutMs: 20_000,
    });

    const json = extractJsonObject(raw);
    const say = String(json.say || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, TTS_SAY_MAX);
    const maybeMatch = String(json.match || "").trim().slice(0, 80);

    if (say) {
      return {
        entry: {
          ...base,
          say,
          match: maybeMatch || match,
        },
        source: "gemini",
      };
    }
  } catch {
    // Fall through to local
  }

  return { entry: base, source: "local" };
}
