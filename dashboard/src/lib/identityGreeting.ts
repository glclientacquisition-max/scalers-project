/**
 * Settings › Identity: the greeting as one sentence an owner can read.
 *
 * Display mirror of the opening the voice line builds (src/speech/callOpening.js
 * PACK identity + invite). Desk shows it and reads it aloud for "Hear it"; it
 * never writes greeting_text and never feeds Brain compile. The stored fields
 * stay spoken_name (40) and greeting_invite (80).
 */

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
const SW_QUESTION_END = /\b(vipi|nini|gani|ngapi|wapi|lini|aje|nani|je)$/i;
const SW_OWNER_WORDS =
  /\b(\w*saidie|\w*hudumie|vipi|nini|gani|ngapi|wapi|lini|aje|karibu|tafadhali|asante|naitwa|hapa ni|tuko|mko|uko|sema|niambie|tuambie)\b/i;

/** The owner's language pick. Automatic is the default and is what calls use today. */
export type GreetingLanguagePick = "auto" | GreetingLanguage;

/**
 * Automatic greeting language, as the voice line picks it with no typed language:
 * Kiswahili when the owner's own question is in Kiswahili, else English.
 */
export function autoGreetingLanguage(greetingInvite: unknown): GreetingLanguage {
  const text = String(greetingInvite ?? "").replace(/\s+/g, " ").trim();
  return text && SW_OWNER_WORDS.test(text) ? "sw" : "en";
}

export function resolveGreetingLanguage(pick: GreetingLanguagePick, greetingInvite: unknown): GreetingLanguage {
  return pick === "auto" ? autoGreetingLanguage(greetingInvite) : pick;
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
  language?: GreetingLanguage;
};

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
  if (!name) {
    return { text: "", name, usesSpokenName, agent, invite, usesDefaultInvite };
  }
  const opening =
    language === "sw"
      ? agent
        ? `Hapa ni ${name}, naitwa ${agent}.`
        : `Hapa ni ${name}.`
      : agent
        ? `${name}, this is ${agent}.`
        : `${name}.`;
  return { text: `${opening} ${invite}`, name, usesSpokenName, agent, invite, usesDefaultInvite };
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
