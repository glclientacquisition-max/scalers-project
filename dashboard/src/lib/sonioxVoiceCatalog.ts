import catalog from "@/data/soniox-voices.json";

export type CuratedSonioxVoice = {
  id: string;
  label: string;
  description?: string;
  default?: boolean;
};

export function listCuratedSonioxVoices(): CuratedSonioxVoice[] {
  const voices = Array.isArray(catalog?.voices) ? catalog.voices : [];
  return voices
    .map((v) => ({
      id: String(v?.id || "").trim(),
      label: String(v?.label || "").trim() || "Voice",
      description: String(v?.description || "").trim(),
      default: Boolean(v?.default),
    }))
    .filter((v) => v.id);
}

export function getDefaultSonioxVoiceId(): string | null {
  const voices = listCuratedSonioxVoices();
  const marked = voices.find((v) => v.default);
  return marked?.id || voices[0]?.id || null;
}

export function isAllowedSonioxVoiceId(voiceId: string | null | undefined): boolean {
  const id = String(voiceId || "").trim();
  if (!id) return false;
  return listCuratedSonioxVoices().some((v) => v.id === id);
}

/** Normalize tenant save / form value to an allowed id or null (platform default). */
export function parseSonioxVoiceId(raw: FormDataEntryValue | string | null | undefined): string | null {
  const id = String(raw || "").trim();
  if (!id) return null;
  return isAllowedSonioxVoiceId(id) ? id : null;
}

export function resolveSonioxVoiceLabel(voiceId: string | null | undefined): string {
  const id = String(voiceId || "").trim();
  const match = listCuratedSonioxVoices().find((v) => v.id === id);
  if (match) return match.label;
  const fallback = getDefaultSonioxVoiceId();
  const defaultVoice = listCuratedSonioxVoices().find((v) => v.id === fallback);
  return defaultVoice?.label || "Default";
}
