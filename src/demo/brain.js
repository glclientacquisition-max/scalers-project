'use strict';

// Demo turns go through the existing Brain engines. Tool writes return
// empty results, so a demo turn cannot book, notify, text, or dial.
// This module does not import a telephony client.

const FALLBACK = Object.freeze({
  en: 'Please say that again.',
  sw: 'Tafadhali sema tena.',
});

async function answerDemoTurn({ text, lang, profile, callSid } = {}) {
  const language = lang === 'sw' ? 'sw' : 'en';
  const spoken = String(text || '').trim();
  if (!spoken) return { text: '', lang: language, end: false };

  const { runBrainEnginesTurn } = require('../conversation/v2/brainEngines');
  const { createLiveHandlers } = require('../conversation/v2/liveHandlers');
  const machine = { langLock: language, slots: {} };
  const applyTools = async () => ({ results: [] });
  const handlers = createLiveHandlers({
    applyTools,
    ctx: {
      tenantId: profile && (profile.id || profile.tenantId) || null,
      callSid: callSid || null,
      demo: true,
    },
  });
  const result = await runBrainEnginesTurn({
    text: spoken,
    profile: profile || {},
    machine,
    langLock: language,
    handlers,
    applyTools,
    opts: {
      log() {},
      ctx: {
        tenantId: profile && (profile.id || profile.tenantId) || null,
        callSid: callSid || null,
      },
    },
  });
  const line = String(result && result.line || '').trim() || FALLBACK[language];
  const outLang = result && (result.lang === 'en' || result.lang === 'sw') ? result.lang : language;
  return { text: line, lang: outLang, end: Boolean(result && result.end) };
}

module.exports = {
  FALLBACK,
  answerDemoTurn,
};
