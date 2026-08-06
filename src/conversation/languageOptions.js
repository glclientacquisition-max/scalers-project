// Voice language catalog for Kenya onboarding (Node voice engine).

const VOICE_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English', speechNative: true },
  { code: 'sw', label: 'Kiswahili', speechNative: true },
  { code: 'sheng', label: 'Sheng' },
  { code: 'kikuyu', label: 'Kikuyu (Gĩkũyũ)' },
  { code: 'luo', label: 'Luo (Dholuo)' },
  { code: 'kamba', label: 'Kamba (Kikamba)' },
  { code: 'kalenjin', label: 'Kalenjin' },
  { code: 'luhya', label: 'Luhya' },
  { code: 'kisii', label: 'Kisii (Ekegusii)' },
  { code: 'meru', label: 'Meru (Kĩmĩĩrũ)' },
  { code: 'somali', label: 'Somali' },
  { code: 'other', label: 'Other Kenyan language' },
];

const ALLOWED = new Set(VOICE_LANGUAGE_OPTIONS.map((o) => o.code));
const DEFAULT_VOICE_LANGUAGES = ['en', 'sw'];

function normalizeVoiceLanguages(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw.map((v) => String(v || '').trim().toLowerCase());
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) list = [];
    else if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed)
          ? parsed.map((v) => String(v || '').trim().toLowerCase())
          : [];
      } catch {
        list = trimmed.split(/[,\s]+/).map((v) => v.trim().toLowerCase());
      }
    } else {
      list = trimmed.split(/[,\s]+/).map((v) => v.trim().toLowerCase());
    }
  }

  const out = [];
  for (const code of list) {
    if (ALLOWED.has(code) && !out.includes(code)) out.push(code);
  }
  return out.length ? out : [...DEFAULT_VOICE_LANGUAGES];
}

function voiceLanguageLabels(codes, otherLabel) {
  return normalizeVoiceLanguages(codes).map((code) => {
    if (code === 'other' && otherLabel && String(otherLabel).trim()) {
      return String(otherLabel).trim();
    }
    return VOICE_LANGUAGE_OPTIONS.find((o) => o.code === code)?.label || code;
  });
}

function formatVoiceLanguagesLine(codes, otherLabel) {
  const labels = voiceLanguageLabels(codes, otherLabel);
  if (!labels.length) return 'English and Kiswahili';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Tenant-level language policy appended to every system prompt.
 * @param {string[]} codes
 * @param {string|null} [otherLabel]
 */
function tenantLanguagePolicy(codes, otherLabel) {
  const langs = normalizeVoiceLanguages(codes);
  const line = formatVoiceLanguagesLine(langs, otherLabel);
  const hasSheng = langs.includes('sheng');
  const locals = langs.filter((c) => !['en', 'sw', 'sheng'].includes(c));

  const parts = [
    `BUSINESS VOICE LANGUAGES (from onboarding): ${line}.`,
    'Mirror the caller within this set. If they use a language outside it, reply in the closest enabled language (prefer English or Kiswahili).',
  ];

  if (hasSheng) {
    parts.push(
      'Sheng is allowed: use natural Kenyan street mix when the caller does — warm and light, never cartoonish or forced slang every sentence.'
    );
  }
  if (locals.length) {
    parts.push(
      `Local languages enabled: ${voiceLanguageLabels(locals, otherLabel).join(', ')}. When the caller speaks one of these, reply in that language in short clear sentences.`
    );
  }
  if (!langs.includes('en') && langs.includes('sw')) {
    parts.push('Default to Kiswahili unless the caller clearly uses another enabled language.');
  } else if (langs.includes('en') && !langs.includes('sw') && !hasSheng) {
    parts.push('Default to English unless the caller clearly uses another enabled language.');
  }

  return parts.join(' ');
}

/** Soniox STT hints from tenant prefs (engine supports en/sw strongly). */
function sttLanguageHints(codes) {
  const langs = normalizeVoiceLanguages(codes);
  const hints = [];
  if (langs.includes('en') || langs.includes('sheng') || langs.includes('somali')) {
    hints.push('en');
  }
  if (
    langs.includes('sw') ||
    langs.includes('sheng') ||
    langs.some((c) => !['en', 'sw', 'sheng', 'somali', 'other'].includes(c))
  ) {
    hints.push('sw');
  }
  if (!hints.length) return ['en', 'sw'];
  return [...new Set(hints)];
}

module.exports = {
  VOICE_LANGUAGE_OPTIONS,
  DEFAULT_VOICE_LANGUAGES,
  normalizeVoiceLanguages,
  voiceLanguageLabels,
  formatVoiceLanguagesLine,
  tenantLanguagePolicy,
  sttLanguageHints,
};
