'use strict';
// Live BA v2 turn. BRAIN_V2=on and BRAIN_V2_MODE=live. Speaks receipt
// sentences. Writes go through createLiveHandlers. Flag off = unused.

const { brainV2Enabled, brainV2Mode } = require('./flag');
const { createState } = require('./machine');
const { runTurnStream } = require('./stream');
const { createLiveHandlers } = require('./liveHandlers');
const { createClassifyAsk } = require('./classifyAsk');
const { createGeminiSend } = require('./transport');

function defaultClassify(opts = {}) {
  if (typeof opts.classify === 'function') return opts.classify;
  const key = opts.apiKey || (opts.env && opts.env.GEMINI_API_KEY) || process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    return createClassifyAsk({
      send: createGeminiSend({ apiKey: key, timeoutMs: 1200, model: opts.classifyModel || 'gemini-3.5-flash-lite' }),
      timeoutMs: 1200,
    });
  } catch {
    return null;
  }
}

function callerFile(opts = {}) {
  const file = opts.callerFile || {};
  const openRows = (Array.isArray(file.openRows) ? file.openRows : []).map((r) => ({
    id: r.id || null,
    service_name: r.service_name || r.job || null,
    window_start: r.window_start || r.windowStart || null,
    address_landmark: r.address_landmark || r.place || null,
    status: r.status || 'requested',
  }));
  return {
    callerPhone: file.callerPhone || opts.callerPhone || null,
    contactName: file.contactName || null,
    openRows,
  };
}

function createBrainV2Live(opts = {}) {
  const env = opts.env || process.env;
  const applyTools = opts.applyTools;
  let state = null;

  function ensureState(profile) {
    if (state) return state;
    const file = callerFile(opts);
    state = createState({
      profile: profile || {},
      callerPhone: file.callerPhone,
      contactName: file.contactName,
      openRows: file.openRows,
    });
    return state;
  }

  async function run({ text, profile, langLock, shouldAbort } = {}) {
    if (!brainV2Enabled({ env, tenantId: profile?.id }) || brainV2Mode({ env }) !== 'live') {
      return null;
    }
    const machine = ensureState(profile);
    const handlers = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })) });
    const sentences = [];
    let done = null;
    const it = runTurnStream(machine, {
      text,
      profile: { ...(profile || {}) },
      now: new Date(),
      handlers,
      model: opts.model || null,
      classify: defaultClassify(opts),
      langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
      shouldAbort: typeof shouldAbort === 'function' ? shouldAbort : () => false,
    });
    for await (const ev of it) {
      if (!ev) continue;
      if (ev.type === 'sentence') sentences.push({ text: ev.text, lang: ev.lang });
      if (ev.type === 'done') done = ev;
    }
    const line = sentences.map((s) => s.text).join(' ').trim() || String(done?.line || '').trim();
    return {
      line,
      lang: sentences[0]?.lang || machine.lang || langLock || 'en',
      sentences,
      end: !!done?.end,
      phase: done?.phase || machine.phase,
    };
  }

  return { run, getState: () => state };
}

module.exports = { createBrainV2Live, callerFile };
