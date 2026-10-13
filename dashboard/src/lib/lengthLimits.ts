import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "./faqs";
import { TTS_MATCH_MAX, TTS_SAY_MAX } from "./pronunciationLexicon";

export const POLICY_TEXT_MAX = 500;

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const len = (v: unknown) => String(v ?? "").trim().length;

/** Return a visible error instead of letting parsers silently cut or drop long text. */
export function policiesLengthError(raw: unknown, labels: Record<string, string> = {}): string | null {
  const obj = parseJson(raw);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const n = len(value);
    if (n > POLICY_TEXT_MAX) {
      return `${labels[key] || key}: ${n} characters, the limit is ${POLICY_TEXT_MAX}. Shorten it and save again.`;
    }
  }
  return null;
}

export function faqsLengthError(raw: unknown): string | null {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i += 1) {
    const row = (list[i] || {}) as Record<string, unknown>;
    if (len(row.question) > FAQ_QUESTION_MAX) {
      return `FAQ ${i + 1}: question is ${len(row.question)} characters, the limit is ${FAQ_QUESTION_MAX}.`;
    }
    if (len(row.answer) > FAQ_ANSWER_MAX) {
      return `FAQ ${i + 1}: answer is ${len(row.answer)} characters, the limit is ${FAQ_ANSWER_MAX}.`;
    }
  }
  return null;
}

export function lexiconLengthError(raw: unknown): string | null {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const row = (item || {}) as Record<string, unknown>;
    const match = String(row.match || row.from || "").trim();
    const say = String(row.say || row.to || "").trim();
    if (match.length > TTS_MATCH_MAX) {
      return `"${match.slice(0, 30)}…" is ${match.length} characters; words are limited to ${TTS_MATCH_MAX}.`;
    }
    if (say.length > TTS_SAY_MAX) {
      return `How to say "${match.slice(0, 30)}" is ${say.length} characters; the limit is ${TTS_SAY_MAX}.`;
    }
  }
  return null;
}
