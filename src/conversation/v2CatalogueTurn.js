'use strict';
// VOICE_V2_CATALOGUE wiring for the live turn. Off: returns the legacy plan
// object untouched (same reference), so output stays byte-identical.
// On: on a catalogue/discovery turn the v2 step (checked command -> state ->
// spoken-catalogue template, locked call language) owns the line. The legacy
// rewrites for this step (catalogue mouth, service dump trim, hedge strip) run
// in shadow over that line and only log what they would have done.
const step = require('./v2/catalogueStep');

let modelSend = null;
function defaultModel(env) {
  if (/^(0|off|false|no)$/i.test(String(env.VOICE_V2_CATALOGUE_MODEL || ''))) return null;
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (!modelSend) modelSend = require('./v2/transport').createGeminiSend({ apiKey, model: env.VOICE_V2_CATALOGUE_MODEL_NAME || 'gemini-3.5-flash-lite', timeoutMs: 700 });
  return modelSend;
}

function shadowLegacy(line, { legacy, profile, language, state, callerText }) {
  const out = [];
  if (legacy?.speakLocal && legacy.line && legacy.line !== line) out.push(`catalogue_mouth would have spoken: ${legacy.line}`);
  try {
    const D = require('./dynamicSpeech');
    const opts = { profile, language, state, callerText, callerTurns: state?.conversation?.answersReceived || [] };
    const dump = D.trimSpokenServiceDump(line, opts);
    if (dump !== line) out.push(`service_dump would have rewritten to: ${dump}`);
    const hedge = D.stripSpokenHedges(line, opts);
    if (hedge !== line) out.push(`hedge_strip would have rewritten to: ${hedge}`);
    const { shapeCatalogueMouth } = require('./catalogueMouth');
    const shaped = shapeCatalogueMouth(line, opts);
    if (shaped !== line) out.push(`catalogue_shape would have rewritten to: ${shaped}`);
  } catch (e) { out.push(`shadow error: ${String(e?.message || e).slice(0, 60)}`); }
  return out;
}

async function planV2CatalogueMouth(legacy, { text, profile, language, state, env = process.env, log = () => {}, model, topicLocked = false } = {}) {
  // BRAIN_V2_TOPIC_PROPOSALS: proposals only (Voice's TurnArbiter decides); the legacy plan is returned untouched.
  if (require('./v2/topic').enabled(env)) {
    try {
      const r = await require('./v2/proposals').proposeTurn({ text, profile, language, state: state || {}, model: model === undefined ? defaultModel(env) : model, legacyLine: legacy?.line || null, nameJustConfirmed: state?.caller?.nameJustConfirmed ?? null });
      log(`v2_topic ${JSON.stringify({ ...r.trace, kinds: r.proposals.map((p) => p.kind), legacyOk: r.legacyCheck ? r.legacyCheck.ok : null })}`);
      const T = require('./v2/topic'); const docVersion = profile?.spokenCataloguePin?.version ?? null;
      return { ...(legacy || {}), v2Proposals: r.proposals.map((p) => T.toArbiter(p, { docVersion })).filter(Boolean), v2Raw: r.proposals, v2LegacyCheck: r.legacyCheck };
    } catch (e) {
      log(`v2_topic error, legacy kept: ${String(e?.message || e).slice(0, 80)}`);
      return legacy;
    }
  }
  if (!step.catalogueStepEnabled(env)) return legacy;
  try {
    const heard = step.looksCatalogue(text, profile, state || {});
    if (!heard && !topicLocked) {
      // Topic closes on a non-catalogue turn, unless VOICE_TURN_ARBITER's lock holds it (barge-in / backchannel).
      if (state?.v2CatalogueState && !topicLocked) state.v2CatalogueState.lastInfo = null;
      return legacy;
    }
    // lang slot: the call language, moved only by v2's sticky language rule on a clear caller turn.
    const L = require('./v2/lexicon');
    const call = /^(sw|sheng)/i.test(String(language || '')) ? 'sw' : /^en/i.test(String(language || '')) ? 'en' : null;
    const holder = state || {};
    const next = L.nextLanguage(holder.v2CatalogueLang || call, text);
    holder.v2CatalogueLang = next || holder.v2CatalogueLang || call || 'en';
    const lang = /^(sw|sheng)/.test(holder.v2CatalogueLang) ? 'sw' : 'en';
    const r = await step.runCatalogueStep({ text, profile, lang, state: holder, model: model === undefined ? defaultModel(env) : model });
    log(`v2_catalogue ${JSON.stringify(r.trace)}`);
    r.trace.intent = r.trace.kind;
    if (!r.line) return legacy;
    // Inside VOICE_TURN_ARBITER's catalogue lock, a turn the regex missed is v2's only if v2 read it as a catalogue ask.
    if (!heard && !['explain', 'explain_text', 'price', 'services', 'service_detail', 'list'].includes(String(r.trace?.kind || ''))) {
      log(`v2_catalogue locked-topic turn not catalogue (kind=${r.trace?.kind}), legacy kept`);
      return legacy;
    }
    for (const s of shadowLegacy(r.line, { legacy, profile, language, state, callerText: text })) log(`v2_catalogue shadow ${s}`);
    return { ...(legacy || {}), speakLocal: true, line: r.line, reason: 'v2_catalogue', v2: r.trace };
  } catch (e) {
    log(`v2_catalogue error, legacy kept: ${String(e?.message || e).slice(0, 80)}`);
    return legacy;
  }
}
module.exports = { planV2CatalogueMouth, shadowLegacy };
