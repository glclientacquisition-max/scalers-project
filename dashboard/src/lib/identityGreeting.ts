/**
 * Settings › Identity: the greeting as one sentence an owner can read.
 *
 * Display mirror of the opening the voice line builds (src/speech/callOpening.js
 * PACK identity + invite). Desk shows it and reads it aloud for "Hear it"; it
 * never writes greeting_text and never feeds Brain compile. The stored fields
 * stay spoken_name (40) and greeting_invite (80).
 */

import {
  ENGLISH_CORE_MARKERS,
  ENGLISH_JOB_LOANWORDS,
  SHENG_MARKERS,
  SWAHILI_MARKERS,
} from "./greetingLanguageMarkers.ts";

export type GreetingLanguage = "en" | "sw";

export const GREETING_LANGUAGES: readonly { id: GreetingLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "sw", label: "Kiswahili" },
];

export const SPOKEN_NAME_MAX = 40;
export const GREETING_INVITE_MAX = 80;

const DEFAULT_INVITE: Record<GreetingLanguage, string> = {
  en: "How can I help?",
  sw: "Nikusaidie vipi?",
};

// Same lists as src/speech/callOpening.js (shopLanguage, SW_QUESTION_END).
const SW_QUESTION_END = /\b(vipi|nini|gani|ngapi|wapi|lini|aje|je)$/i;
const SW_OWNER_WORDS =
  /\b(\w*saidie|\w*hudumie|vipi|nini|gani|ngapi|wapi|lini|aje|karibu|tafadhali|asante|naitwa|hapa ni|tuko|mko|uko|sema|niambie|tuambie)\b/i;

/** The owner's language pick. Automatic (stored null) is the default. */
export type GreetingLanguagePick = "auto" | GreetingLanguage;

/** tenants.greeting_language: 'en' | 'sw' | null (check constraint). */
export type StoredGreetingLanguage = GreetingLanguage | null;

/** Stored column to the row's pick. Anything but en or sw reads as Automatic. */
export function greetingLanguagePickFromStored(raw: unknown): GreetingLanguagePick {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "en" || v === "sw" ? v : "auto";
}

/** The row's pick to the stored column: Automatic is null. */
export function greetingLanguageForStorage(pick: GreetingLanguagePick): StoredGreetingLanguage {
  return pick === "en" || pick === "sw" ? pick : null;
}

/**
 * The posted greeting_language field. auto or empty is null (Automatic),
 * en and sw stay, anything else is undefined (not a valid pick: keep stored).
 */
export function parseGreetingLanguageField(raw: unknown): StoredGreetingLanguage | undefined {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v || v === "auto") return null;
  if (v === "en" || v === "sw") return v;
  return undefined;
}

function markerAppears(raw: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(raw);
}

function countMarkers(raw: string, markers: readonly string[]): number {
  return markers.reduce((n, m) => n + (markerAppears(raw, m) ? 1 : 0), 0);
}

/** Mirror of analyzeCallerLanguage (keyword path) in src/conversation/language.js. */
export function ownerTextLanguage(text: unknown): "en" | "sw" | "sheng" | "mixed" | "unknown" {
  const raw = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return "unknown";
  const sw = countMarkers(raw, SWAHILI_MARKERS);
  let en = countMarkers(raw, ENGLISH_CORE_MARKERS);
  const loan = countMarkers(raw, ENGLISH_JOB_LOANWORDS);
  const sheng = countMarkers(raw, SHENG_MARKERS);
  if (sw === 0) en += loan;
  if (!sw && !sheng && /\b(i|my|you|we|the|a|an|is|are|can|do|what|how|when|where)\b/.test(raw)) en += 2;
  if (sheng >= 2 && sheng >= sw && sheng >= en) return "sheng";
  if (sw === 0 && en === 0) return "unknown";
  if (sw > 0 && en > 0) {
    if (sw >= en + 2) return "sw";
    if (en >= sw + 2) return "en";
    return "mixed";
  }
  return sw > en ? "sw" : "en";
}

function sameWords(text: string): GreetingLanguage | null {
  if (SW_OWNER_WORDS.test(text)) return "sw";
  const lang = ownerTextLanguage(text);
  if (lang === "sw" || lang === "sheng") return "sw";
  if (lang === "en") return "en";
  if (lang === "mixed") {
    const raw = text.toLowerCase();
    const sw = countMarkers(raw, SWAHILI_MARKERS);
    const en = countMarkers(raw, ENGLISH_CORE_MARKERS);
    return sw >= en ? "sw" : "en";
  }
  return null;
}

/**
 * Automatic greeting language, as the voice line picks it (shopLanguage in
 * src/speech/callOpening.js) with no stored choice: the language of the
 * owner's own words, greeting_text first, then greeting_invite (Kiswahili
 * shop words first, Sheng counts as Kiswahili), else English.
 */
export function autoGreetingLanguage(greetingInvite: unknown, greetingText?: unknown): GreetingLanguage {
  for (const raw of [greetingText, greetingInvite]) {
    const text = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const lang = sameWords(text);
    if (lang) return lang;
  }
  return "en";
}

/** The business's default greeting language: the stored choice, else Automatic. */
export function resolveGreetingLanguage(
  pick: GreetingLanguagePick,
  greetingInvite: unknown,
  greetingText?: unknown
): GreetingLanguage {
  return pick === "auto" ? autoGreetingLanguage(greetingInvite, greetingText) : pick;
}

export function parseGreetingLanguage(raw: unknown): GreetingLanguage {
  return String(raw || "").trim().toLowerCase() === "sw" ? "sw" : "en";
}

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function isDefaultAgent(name: string): boolean {
  return !name || /^receptionist$/i.test(name);
}

/** The owner's question, with the end mark the voice line adds. Empty or stock: the default. */
export function greetingInviteLine(invite: unknown, language: GreetingLanguage = "en"): string {
  const raw = clean(invite, GREETING_INVITE_MAX);
  const bare = raw.replace(/[.!?\u2026]+$/g, "").trim();
  if (!raw || /^how can i help$/i.test(bare)) return DEFAULT_INVITE[language];
  if (/[.!?\u2026]$/.test(raw)) return raw.charAt(0).toUpperCase() + raw.slice(1);
  const question =
    SW_QUESTION_END.test(raw) || /^(how|what|where|when|who|which|can|could|would|may)\b/i.test(raw);
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}${question ? "?" : "."}`;
}

export type GreetingInput = {
  businessName?: string | null;
  spokenName?: string | null;
  agentName?: string | null;
  greetingInvite?: string | null;
  /** tenants.greeting_text: the owner's full greeting, said word for word (Desk never writes it). */
  greetingText?: string | null;
  language?: GreetingLanguage;
  /** Add the recording notice line (prod records calls). Default true. */
  recordingNotice?: boolean;
};

/**
 * The recording notice after the question. Prod runs the reason-led variants
 * (src/speech/recordingNoticeVariant.js); a call hears one of a, b or c, so
 * Desk shows b as the representative line and does not claim exact wording.
 */
export const RECORDING_NOTICE_PREVIEW: Record<GreetingLanguage, string> = {
  en: "For service quality, this call is recorded.",
  sw: "Kwa ubora wa huduma, simu hii inarekodiwa.",
};

function endSentence(text: string): string {
  return text && !/[.!?\u2026]$/.test(text) ? `${text}.` : text;
}

export type GreetingSentence = {
  /** What callers hear, as one line. Empty when there is no name to say. */
  text: string;
  /** The name said first: spoken name, else the business name. */
  name: string;
  /** True when the spoken name is set (not the business name fallback). */
  usesSpokenName: boolean;
  /** The assistant name said, or "" for the default. */
  agent: string;
  /** The question after the name. */
  invite: string;
  usesDefaultInvite: boolean;
  /** True when the owner's full greeting_text is said instead of the template. */
  usesGreetingText: boolean;
  /** The recording notice said after the question, or "" (off, or the owner's words mention it). */
  notice: string;
};

export function buildGreetingSentence(input: GreetingInput): GreetingSentence {
  const language = input.language === "sw" ? "sw" : "en";
  const spoken = clean(input.spokenName, SPOKEN_NAME_MAX);
  const usesSpokenName = Boolean(spoken) && !/^the business$/i.test(spoken);
  const name = usesSpokenName ? spoken : clean(input.businessName, 120);
  const agentRaw = clean(input.agentName, 40);
  const agent = isDefaultAgent(agentRaw) ? "" : agentRaw;
  const invite = greetingInviteLine(input.greetingInvite, language);
  const usesDefaultInvite = invite === DEFAULT_INVITE[language];
  const owner = clean(input.greetingText, 400);
  const usesGreetingText = Boolean(owner);
  const ownerSaysRecord = usesGreetingText && /\b(record|rekodi)/i.test(owner);
  const notice = input.recordingNotice === false || ownerSaysRecord ? "" : RECORDING_NOTICE_PREVIEW[language];
  const base = { name, usesSpokenName, agent, invite, usesDefaultInvite, usesGreetingText };
  if (usesGreetingText) {
    // The owner's whole greeting already ends with their question.
    return { ...base, text: endSentence(owner), notice };
  }
  if (!name) return { ...base, text: "", notice: "" };
  const opening =
    language === "sw"
      ? agent
        ? `Hapa ni ${name}, naitwa ${agent}.`
        : `Hapa ni ${name}.`
      : agent
        ? `${name}, this is ${agent}.`
        : `${name}.`;
  return { ...base, text: `${opening} ${invite}`, notice };
}

/**
 * Automatic greeting: no name of its own and no question of its own, so the
 * voice line builds it from the business name, the assistant name and the
 * stock question. It follows a business rename until the owner customizes it.
 * Stored as empty spoken_name and greeting_invite (no new column).
 */
export function greetingIsAutomatic(fields: { spokenName?: string | null; greetingInvite?: string | null }): boolean {
  const spoken = clean(fields.spokenName, SPOKEN_NAME_MAX);
  const usesSpoken = Boolean(spoken) && !/^the business$/i.test(spoken);
  const invite = clean(fields.greetingInvite, GREETING_INVITE_MAX).replace(/[.!?\u2026]+$/g, "").trim();
  return !usesSpoken && (!invite || /^how can i help$/i.test(invite));
}
