// Structured voice reply. Gemini returns JSON. Code checks the locked
// language and the sentence list. Normalization may change pronunciation
// and punctuation. It may not delete a non-empty answer.

const { prepareForTts } = require('./ttsNormalize');
const { getLanguagePack } = require('./languages');

const STRUCTURED_PROMPT_ID = 'voice.structured';
const STRUCTURED_PROMPT_VERSION = '2026-10-06.1';

const STRUCTURED_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply_language: { type: 'string', enum: ['en', 'sw', 'sheng'] },
    spoken_sentences: { type: 'array', items: { type: 'string' } },
    intent: { type: 'string' },
    answered_question: { type: 'boolean' },
    needs_handoff: { type: 'boolean' },
    tool_json: { type: 'string' },
    end_call: { type: 'boolean' },
  },
  required: ['reply_language', 'spoken_sentences', 'intent', 'answered_question', 'needs_handoff'],
};

const MARKUP = /[*_`#]|^\s*[-•]\s/m;
const BAD_SYMBOLS = /[&@^|\\<>[\]{}]/;
const CLOSING_ONLY =
  /^(how (?:else )?can i help(?: you)?(?: today)?|what do you need(?: done)?|which service(?: would you like)?|how else|ungependa(?:\s+\w+){0,4}|unahitaji(?:\s+\w+){0,3}|naweza kusaidia(?:\s+\w+){0,3}|huduma gani|kuna huduma|anything else)\b/i;

function repairLine(lang) {
  return getLanguagePack(lang).repair;
}

function silenceLine(lang) {
  return getLanguagePack(lang).silence;
}

function structuredSystemAddendum(lang) {
  const pack = getLanguagePack(lang);
  const code = pack.code;
  return [
    'Reply as JSON only.',
    `Set reply_language to "${code}" and write every spoken sentence in that language.`,
    'Emit reply_language before spoken_sentences.',
    'spoken_sentences is an array of complete sentences the caller hears.',
    'No markdown, no bullets, no labels, no symbols.',
    'Answer the caller question in this turn. Do not replace the answer with only a follow-up question.',
    'Put a tool payload in tool_json as a JSON string, or use an empty string. Do not speak the tool.',
    pack.directive,
  ].join(' ');
}

function structuredGeminiConfig(systemPrompt, lockedLanguage) {
  const addendum = structuredSystemAddendum(lockedLanguage);
  const base = String(systemPrompt || '');
  const instruction = base.includes('Reply as JSON only.')
    ? base
    : [base, addendum].filter(Boolean).join('\n\n');
  return {
    systemInstruction: { parts: [{ text: instruction }] },
    temperature: Number(process.env.GEMINI_VOICE_TEMPERATURE || 0.35),
    maxOutputTokens: Number(process.env.GEMINI_STRUCTURED_MAX_OUTPUT_TOKENS || 384),
    thinkingConfig: {
      thinkingLevel: process.env.GEMINI_THINKING_LEVEL || 'MINIMAL',
    },
    responseMimeType: 'application/json',
    responseJsonSchema: STRUCTURED_REPLY_SCHEMA,
  };
}

function correctiveInstruction(lockedLanguage, problems) {
  const code = getLanguagePack(lockedLanguage).code;
  const why = (problems || []).join(', ') || 'invalid';
  return `Corrective turn. The locked reply language is ${code}. The previous JSON failed (${why}). Set reply_language to "${code}" exactly. spoken_sentences must be complete spoken sentences in ${code} only. No markdown, no bullets, no symbols. Do not leave spoken_sentences empty. Keep the facts from the previous answer.`;
}

function stripJsonFence(text) {
  let raw = String(text || '').trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return raw.trim();
}

function parseStructuredJson(text) {
  const raw = stripJsonFence(text);
  if (!raw) return { ok: false, error: 'empty', value: null };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'not_object', value: null };
    }
    return { ok: true, error: '', value };
  } catch (err) {
    return { ok: false, error: 'parse', value: null };
  }
}

function finishSentence(text) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  raw = raw.replace(/^[-•*]\s+/, '').replace(/[*_`#]+/g, '');
  if (!raw) return '';
  if (!/[.!?]$/.test(raw)) raw = `${raw}.`;
  return raw;
}

function validateStructuredReply(obj, lockedLanguage) {
  const problems = [];
  const locked = getLanguagePack(lockedLanguage).code;
  if (!obj || typeof obj !== 'object') {
    return { ok: false, problems: ['not_object'], sentences: [], language: '' };
  }
  const language = String(obj.reply_language || '');
  if (!['en', 'sw', 'sheng'].includes(language)) problems.push('language_field');
  else if (language !== locked) problems.push('language_mismatch');
  if (!Array.isArray(obj.spoken_sentences) || obj.spoken_sentences.length === 0) {
    problems.push('no_sentences');
  }
  const sentences = [];
  for (const row of Array.isArray(obj.spoken_sentences) ? obj.spoken_sentences : []) {
    const text = finishSentence(row);
    if (!text) {
      problems.push('empty_sentence');
      continue;
    }
    if (MARKUP.test(text) || BAD_SYMBOLS.test(text)) problems.push('markup');
    sentences.push(text);
  }
  if (typeof obj.answered_question !== 'boolean') problems.push('answered_flag');
  if (typeof obj.needs_handoff !== 'boolean') problems.push('handoff_flag');
  if (obj.tool_json != null && obj.tool_json !== '') {
    try {
      const parsed = JSON.parse(String(obj.tool_json));
      if (!parsed || typeof parsed !== 'object') problems.push('tool_json');
    } catch {
      problems.push('tool_json');
    }
  }
  return {
    ok: problems.length === 0 && sentences.length > 0,
    problems,
    sentences,
    language,
  };
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isClosingQuestionOnly(text) {
  const parts = splitSentences(text);
  if (!parts.length) return !String(text || '').trim();
  return parts.every((part) => {
    const bare = part.replace(/[.!?]+$/g, '').trim();
    return CLOSING_ONLY.test(bare);
  });
}

function substantiveAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (isClosingQuestionOnly(raw)) return false;
  return true;
}

/**
 * A non-empty model answer is never reduced to empty or to only a closing question.
 * @returns {{ text: string, restored: boolean, reason: string }}
 */
function protectSpokenAnswer(modelAnswer, normalized) {
  const before = String(modelAnswer || '').replace(/\s+/g, ' ').trim();
  const after = String(normalized || '').replace(/\s+/g, ' ').trim();
  if (!before) return { text: after, restored: false, reason: '' };
  if (!after) {
    logRemoval('empty_drop', before, '');
    return { text: before, restored: true, reason: 'blocked_empty_drop' };
  }
  if (substantiveAnswer(before) && isClosingQuestionOnly(after)) {
    logRemoval('closing_only', before, after);
    return { text: before, restored: true, reason: 'blocked_closing_only' };
  }
  return { text: after, restored: false, reason: '' };
}

function logRemoval(reason, before, after) {
  const dropped = String(before || '').replace(/\s+/g, ' ').trim();
  console.warn(
    `[structured-reply] removal blocked reason=${reason} chars=${dropped.length} text=${JSON.stringify(dropped.slice(0, 180))} after=${JSON.stringify(String(after || '').slice(0, 120))}`
  );
}

function normalizeStructuredSentence(text, opts = {}) {
  const language = getLanguagePack(opts.language).code;
  const prepared = prepareForTts(text, {
    callLanguage: language === 'sheng' ? 'sheng' : language,
    avoidRespell: true,
  });
  let spoken = prepared.text;
  if (!spoken.trim() && String(text || '').trim()) {
    spoken = String(text)
      .replace(/[*_`#]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return { text: spoken, language: prepared.language || (language === 'sw' ? 'sw' : 'en') };
}

function bestFallbackSentences(partialSentences, lockedLanguage) {
  const cleaned = (partialSentences || []).map(finishSentence).filter(Boolean);
  if (cleaned.length) return cleaned;
  return [repairLine(lockedLanguage)];
}

function reconstructModelText(obj) {
  const spoken = (Array.isArray(obj?.spoken_sentences) ? obj.spoken_sentences : [])
    .map(finishSentence)
    .filter(Boolean)
    .join(' ');
  let tool = String(obj?.tool_json || '').trim();
  if (tool) {
    try {
      JSON.parse(tool);
    } catch {
      tool = '';
    }
  }
  const block = tool ? ` ###TOOL###${tool}###ENDTOOL###` : '';
  const end = obj?.end_call ? ' ###ENDCALL###' : '';
  return `${spoken}${block}${end}`.trim();
}

module.exports = {
  STRUCTURED_PROMPT_ID,
  STRUCTURED_PROMPT_VERSION,
  STRUCTURED_REPLY_SCHEMA,
  repairLine,
  silenceLine,
  structuredSystemAddendum,
  structuredGeminiConfig,
  correctiveInstruction,
  parseStructuredJson,
  validateStructuredReply,
  protectSpokenAnswer,
  normalizeStructuredSentence,
  finishSentence,
  isClosingQuestionOnly,
  bestFallbackSentences,
  reconstructModelText,
  splitSentences,
};
