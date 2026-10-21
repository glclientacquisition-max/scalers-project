/**
 * Owner greeting (tenants.greeting_text + tenants.greeting_language).
 *
 * Column contract: docs/supabase/greeting_language.sql (Platform, PR #844).
 * - greeting_text: text, CHECK char_length <= 240. NULL uses the template.
 * - greeting_language: text, CHECK in ('en','sw'), no default. NULL means
 *   Voice works the language out from the greeting text (or the template).
 *
 * The preview mirrors composeOpening() in src/speech/callOpening.js (Voice,
 * PR #843) for a new caller while the business is open. Keep these in sync.
 * Pure: safe to import from server actions, client components and tests.
 */

export const GREETING_TEXT_MAX = 240;

export const GREETING_LANGUAGES = ["en", "sw"] as const;
export type GreetingLanguage = (typeof GREETING_LANGUAGES)[number];

/**
 * Mirror of src/conversation/recordingNotice.js (RECORDING_NOTICE_EN / _SW).
 * That file is CommonJS on the voice side and is not importable here.
 * Voice speaks it only while VOICE_STREAM_RECORD is on.
 */
export const RECORDING_NOTICE_EN = "This call may be recorded.";
export const RECORDING_NOTICE_SW = "Simu hii inaweza kurekodiwa.";

/** Mirror of PACK.{en,sw}.invite in src/speech/callOpening.js. */
const DEFAULT_INVITE: Record<GreetingLanguage, string> = {
  en: "How can I help?",
  sw: "Nikusaidie vipi?",
};

/** Mirror of SW_OWNER_WORDS and SW_QUESTION_END in src/speech/callOpening.js. */
const SW_OWNER_WORDS =
  /\b(\w*saidie|\w*hudumie|vipi|nini|gani|ngapi|wapi|lini|aje|karibu|tafadhali|asante|naitwa|hapa ni|tuko|mko|uko|sema|niambie|tuambie)\b/i;
const SW_QUESTION_END = /\b(vipi|nini|gani|ngapi|wapi|lini|aje|je)$/i;
/**
 * Common greeting words Voice's analyzeCallerLanguage() also reads as Swahili.
 * Desk-only: lets the hint match Voice for lines like "Habari, Esga hapa".
 */
const SW_GREETING_WORDS = /\b(habari|sasa|hapa|leo)\b/i;
const OWNER_MENTIONS_RECORDING = /\b(record|rekodi)/i;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function endSentence(text: string): string {
  const t = clean(text);
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** What gets stored: whitespace folded, clipped to 240, empty becomes NULL. */
export function normalizeGreetingText(raw: unknown): string | null {
  const text = clean(raw).slice(0, GREETING_TEXT_MAX).trim();
  return text || null;
}

/** 'en' | 'sw' | null. Anything else (sheng, blank, junk) is null. */
export function parseGreetingLanguage(raw: unknown): GreetingLanguage | null {
  const v = clean(raw).toLowerCase();
  return v === "en" || v === "sw" ? v : null;
}

/**
 * The language Voice will speak when greeting_language is NULL: the owner's
 * own words decide (greeting text, then the short invite), else English.
 * Voice also runs analyzeCallerLanguage() on the text; this keeps the Swahili
 * word check only, which covers short owner lines.
 */
export function detectGreetingLanguage(opts: {
  greetingText?: string | null;
  greetingInvite?: string | null;
}): GreetingLanguage {
  for (const raw of [opts.greetingText, opts.greetingInvite]) {
    const text = clean(raw);
    if (text && (SW_OWNER_WORDS.test(text) || SW_GREETING_WORDS.test(text))) return "sw";
  }
  return "en";
}

function isDefaultAgentName(value: unknown): boolean {
  const agent = clean(value);
  return !agent || /^receptionist$/i.test(agent);
}

function isDefaultShopName(value: unknown): boolean {
  const shop = clean(value);
  return !shop || /^the business$/i.test(shop);
}

function inviteLine(greetingInvite: unknown, lang: GreetingLanguage): string {
  const raw = clean(greetingInvite).slice(0, 80).trim();
  const bare = raw.replace(/[.!?…]+$/g, "").trim();
  if (!raw || /^how can i help$/i.test(bare)) return DEFAULT_INVITE[lang];
  if (/[.!?…]$/.test(raw)) return raw.charAt(0).toUpperCase() + raw.slice(1);
  const question = SW_QUESTION_END.test(raw) || /^(how|what|where|when|who|which|can|could|would|may)\b/i.test(raw);
  const line = `${raw}${question ? "?" : "."}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export type GreetingPreviewInput = {
  greetingText?: string | null;
  greetingLanguage?: string | null;
  businessName?: string | null;
  spokenName?: string | null;
  agentName?: string | null;
  greetingInvite?: string | null;
  /** Default true: the preview shows the notice callers hear while recording is on. */
  recordingNotice?: boolean;
};

export type GreetingPreview = {
  /** The full opening, as one line. */
  text: string;
  /** The owner's words (or the template) without the notice. */
  greeting: string;
  /** The notice appended, or "" when not spoken. */
  notice: string;
  language: GreetingLanguage;
  /** True when greeting_language is NULL and the language was worked out. */
  languageDetected: boolean;
  /** True when the owner text is empty and the template is used. */
  usesTemplate: boolean;
};

/** The opening a new caller hears while the business is open. */
export function composeGreetingPreview(input: GreetingPreviewInput): GreetingPreview {
  const owner = normalizeGreetingText(input.greetingText);
  const typed = parseGreetingLanguage(input.greetingLanguage);
  const language =
    typed ?? detectGreetingLanguage({ greetingText: owner, greetingInvite: input.greetingInvite });

  const noticeOn = input.recordingNotice !== false && !(owner && OWNER_MENTIONS_RECORDING.test(owner));
  const notice = noticeOn ? (language === "sw" ? RECORDING_NOTICE_SW : RECORDING_NOTICE_EN) : "";

  if (owner) {
    // Spoken verbatim (Voice only adds a closing full stop). The owner's text
    // already ends with their question, so the notice follows it.
    const greeting = endSentence(owner);
    const text = [greeting, notice].filter(Boolean).join(" ");
    return { text, greeting, notice, language, languageDetected: !typed, usesTemplate: false };
  }

  // Template (composeOpening identity, notice, invite).
  const spoken = clean(input.spokenName).slice(0, 40).trim();
  const shop =
    (spoken && !isDefaultShopName(spoken) ? spoken : "") || clean(input.businessName) || "the business";
  const agentRaw = clean(input.agentName);
  const agent = isDefaultAgentName(agentRaw) ? "" : agentRaw;
  const identity =
    language === "sw"
      ? agent
        ? `Hapa ni ${shop}, naitwa ${agent}.`
        : `Hapa ni ${shop}.`
      : agent
        ? `${shop}, this is ${agent}.`
        : `${shop}.`;
  const invite = inviteLine(input.greetingInvite, language);
  const greeting = `${identity} ${invite}`;
  const text = [identity, notice, invite].filter(Boolean).join(" ");
  return { text, greeting, notice, language, languageDetected: !typed, usesTemplate: true };
}

/** Columns this module reads, for selects and missing-column peels. */
export const GREETING_COLUMNS = ["greeting_text", "greeting_language"] as const;

export function isMissingGreetingColumnError(message: string | null | undefined): boolean {
  return /greeting_text|greeting_language/i.test(String(message || ""));
}

/**
 * The tenants patch for a Settings save. Only the Identity panel owns these.
 * greeting_text is written only when the form posted it; greeting_language
 * only when the owner picked one (the field is absent until then), so saving
 * Identity for another reason never writes a language.
 */
export function greetingPatchFromForm(
  owns: boolean,
  formData: Pick<FormData, "has" | "get">
): { patch: Record<string, unknown>; error?: string } {
  if (!owns) return { patch: {} };
  const patch: Record<string, unknown> = {};
  if (formData.has("greeting_text")) {
    const raw = clean(formData.get("greeting_text"));
    if (raw.length > GREETING_TEXT_MAX) {
      return { patch: {}, error: `Greeting should be ${GREETING_TEXT_MAX} characters or fewer.` };
    }
    patch.greeting_text = normalizeGreetingText(raw);
  }
  if (formData.has("greeting_language")) {
    const lang = parseGreetingLanguage(formData.get("greeting_language"));
    if (lang) patch.greeting_language = lang;
  }
  return { patch };
}

/** Patch without the greeting columns, for a database that does not have them yet. */
export function withoutGreetingColumns(
  message: string | null | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> | null {
  if (!isMissingGreetingColumnError(message)) return null;
  if (!GREETING_COLUMNS.some((col) => col in patch)) return null;
  const next = { ...patch };
  for (const col of GREETING_COLUMNS) delete next[col];
  return next;
}
