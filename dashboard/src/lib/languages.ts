/** Shared voice-language options for onboarding + Business settings. */

export type VoiceLanguageCode =
  | "en"
  | "sw"
  | "sheng"
  | "kikuyu"
  | "luo"
  | "kamba"
  | "kalenjin"
  | "luhya"
  | "kisii"
  | "meru"
  | "somali"
  | "other";

export type VoiceLanguageOption = {
  code: VoiceLanguageCode;
  label: string;
  hint: string;
  /** Strong STT/TTS support today */
  speechNative?: boolean;
};

export const VOICE_LANGUAGE_OPTIONS: VoiceLanguageOption[] = [
  {
    code: "en",
    label: "English",
    hint: "Clear Kenyan business English",
    speechNative: true,
  },
  {
    code: "sw",
    label: "Kiswahili",
    hint: "Natural conversational Swahili",
    speechNative: true,
  },
  {
    code: "sheng",
    label: "Sheng",
    hint: "Nairobi street mix — warm, not forced",
  },
  {
    code: "kikuyu",
    label: "Kikuyu (Gĩkũyũ)",
    hint: "Reply in Kikuyu when callers use it",
  },
  {
    code: "luo",
    label: "Luo (Dholuo)",
    hint: "Reply in Luo when callers use it",
  },
  {
    code: "kamba",
    label: "Kamba (Kikamba)",
    hint: "Reply in Kamba when callers use it",
  },
  {
    code: "kalenjin",
    label: "Kalenjin",
    hint: "Reply in Kalenjin when callers use it",
  },
  {
    code: "luhya",
    label: "Luhya",
    hint: "Reply in Luhya when callers use it",
  },
  {
    code: "kisii",
    label: "Kisii (Ekegusii)",
    hint: "Reply in Kisii when callers use it",
  },
  {
    code: "meru",
    label: "Meru (Kĩmĩĩrũ)",
    hint: "Reply in Meru when callers use it",
  },
  {
    code: "somali",
    label: "Somali",
    hint: "Reply in Somali when callers use it",
  },
  {
    code: "other",
    label: "Other Kenyan language",
    hint: "Name it below — receptionist will try to match",
  },
];

const ALLOWED = new Set(VOICE_LANGUAGE_OPTIONS.map((o) => o.code));

export const DEFAULT_VOICE_LANGUAGES: VoiceLanguageCode[] = ["en", "sw"];

export function isVoiceLanguageCode(value: string): value is VoiceLanguageCode {
  return ALLOWED.has(value as VoiceLanguageCode);
}

/** Normalize checkbox / JSON / Postgres array input. */
export function normalizeVoiceLanguages(raw: unknown): VoiceLanguageCode[] {
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((v) => String(v || "").trim().toLowerCase());
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) list = [];
    else if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed)
          ? parsed.map((v) => String(v || "").trim().toLowerCase())
          : [];
      } catch {
        list = trimmed.split(/[,\s]+/).map((v) => v.trim().toLowerCase());
      }
    } else {
      list = trimmed.split(/[,\s]+/).map((v) => v.trim().toLowerCase());
    }
  }

  const out: VoiceLanguageCode[] = [];
  for (const code of list) {
    if (isVoiceLanguageCode(code) && !out.includes(code)) out.push(code);
  }
  return out.length ? out : [...DEFAULT_VOICE_LANGUAGES];
}

export function voiceLanguageLabels(
  codes: VoiceLanguageCode[],
  otherLabel?: string | null
): string[] {
  return codes.map((code) => {
    if (code === "other" && otherLabel?.trim()) return otherLabel.trim();
    return VOICE_LANGUAGE_OPTIONS.find((o) => o.code === code)?.label || code;
  });
}

/** Human line for default prompts / UI summary. */
export function formatVoiceLanguagesLine(
  codes: VoiceLanguageCode[],
  otherLabel?: string | null
): string {
  const labels = voiceLanguageLabels(codes, otherLabel);
  if (!labels.length) return "English and Kiswahili";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
