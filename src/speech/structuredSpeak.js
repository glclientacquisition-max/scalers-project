// Structured mouth for one streamed sentence.
// Normalize for TTS. Never delete a non-empty answer down to silence
// or to only a closing question. The playback loop stays in server.js.

const { normalizeStructuredSentence, protectSpokenAnswer } = require('./structuredReply');
const { prepareForTts } = require('./ttsNormalize');

function prepareStructuredChunk(chunk, { language } = {}) {
  const raw = String(chunk || '');
  const normalized = normalizeStructuredSentence(raw, { language });
  const guarded = protectSpokenAnswer(raw, normalized.text);
  return {
    raw,
    text: guarded.text,
    restored: Boolean(guarded.restored),
    reason: guarded.reason || 'normalized',
    stage: guarded.restored ? 'no_silent_drop' : 'tts_normalize',
  };
}

function traceStructuredChunk(chunk, { language, lexicon, trace, traceTransform, traceTts } = {}) {
  const prepared = prepareStructuredChunk(chunk, { language });
  if (typeof traceTransform === 'function') {
    traceTransform(trace, {
      stage: prepared.stage,
      before: prepared.raw,
      after: prepared.text,
      reason: prepared.reason,
      dropped: false,
      force: prepared.restored,
    });
  }
  if (!prepared.text) return prepared;
  const traced = prepareForTts(prepared.text, {
    callLanguage: language,
    extraLexicon: lexicon || [],
    avoidRespell: true,
  });
  if (typeof traceTts === 'function') {
    traceTts(trace, {
      text: traced.text,
      before: prepared.text,
      language: traced.language,
    });
  }
  return { ...prepared, ttsText: traced.text, ttsLanguage: traced.language };
}

module.exports = {
  prepareStructuredChunk,
  traceStructuredChunk,
};
