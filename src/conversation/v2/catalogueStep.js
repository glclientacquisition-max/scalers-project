'use strict';
// v2 catalogue / discovery step (migration step 3, proven-voice-pipeline.md).
// CALM pattern: the model may emit one checked command; v2 nlu.js is the intent
// source otherwise. machine.catalogueTurn decides; receipts.js renders; the
// tenant's spoken catalogue (src/knowledge/spokenCatalogue.js) is the only data
// for service words, categories, explanations and prices, in the locked language.
const { validate } = require('./catalogue');
const { resolveSpokenCatalogueMeta } = require('../../knowledge/spokenCatalogue');
const N = require('./nlu');

const ON = /^(1|true|on|yes)$/i;
const catalogueStepEnabled = (env = process.env) => ON.test(String(env.VOICE_V2_CATALOGUE || ''));
const INTENTS = ['list_services', 'explain_service', 'price_service', 'other'];

function commandSchema(sc) {
  const ids = sc.entries.map((e) => e.id);
  return { type: 'object', additionalProperties: false, required: ['intent', 'language'], properties: {
    intent: { type: 'string', enum: INTENTS },
    service_id: { type: 'string', enum: ids.length ? ids : ['__none__'] },
    language: { type: 'string', enum: ['sw', 'en'] },
  } };
}
function validateCommand(cmd, sc) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, errors: ['$: expected object'] };
  const clean = Object.fromEntries(Object.entries(cmd).filter(([, v]) => v != null && v !== ''));
  const errors = validate(commandSchema(sc), clean);
  if (!errors.length && ['explain_service', 'price_service'].includes(clean.intent) && !clean.service_id) errors.push('$.service_id: required for intent');
  return errors.length ? { ok: false, errors } : { ok: true, command: clean };
}
function buildCommandRequest({ text, sc, lang }) {
  const menu = sc.entries.map((e) => ({ service_id: e.id, name: e.raw.name }));
  return {
    systemInstruction: { parts: [{ text: `Classify the caller's latest turn about this business's services. Output only the JSON command, never a reply. list_services = asks what services exist; explain_service = asks what one service means/includes; price_service = asks the price of one service; other = anything else (booking, hours, areas, greetings). Call language: ${lang}.\nServices: ${JSON.stringify(menu)}` }] },
    contents: [{ role: 'user', parts: [{ text: String(text || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 64, responseMimeType: 'application/json', responseJsonSchema: commandSchema(sc) }, // JSON Schema (lowercase types) goes in responseJsonSchema, as #702
  };
}
function parseCommandResponse(resp) {
  const t = (resp?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(t); } catch { return null; }
}
// Cheap gate (nlu intents) so the step and its model call only run on catalogue turns.
function looksCatalogue(text, profile, state = {}) {
  const u = N.understand(text, { profile: profile || {}, now: new Date(), topic: state?.v2CatalogueState?.lastInfo || null });
  // BRAIN_V2_NLU_GAPS §4 "mnasafisha carpet?" is a service check: the step answers it like a one-service ask.
  return u.intents.includes('services') || (u.intents.includes('check') && Boolean(u.service)) || ((u.intents.includes('explain') || u.intents.includes('price')) && Boolean(u.service));
}
async function modelCommand({ model, text, sc, lang, timeoutMs }) {
  const t0 = Date.now();
  try {
    let timer;
    const resp = await Promise.race([model(buildCommandRequest({ text, sc, lang })), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })]).finally(() => clearTimeout(timer));
    const v = validateCommand(parseCommandResponse(resp), sc);
    return { ms: Date.now() - t0, command: v.ok ? v.command : null, error: v.ok ? null : v.errors.slice(0, 2).join('; ') };
  } catch (e) { return { ms: Date.now() - t0, command: null, error: String(e?.message || e).slice(0, 60) }; }
}
async function runCatalogueStep({ text, profile, lang, state, model = null, timeoutMs = 700 }) {
  const M = require('./machine');
  const scMeta = resolveSpokenCatalogueMeta(profile || {});
  const sc = scMeta.doc;
  if (!sc.entries.length) return { line: null, trace: { step: 'catalogue', yield: 'empty_catalogue' } };
  const holder = state || {};
  const v2 = (holder.v2CatalogueState ||= M.createState({ profile }));
  let mc = null;
  // VOICE_NLU_FIRST_INTENT: skip the separate classify when nlu is confident.
  const G = require('./intentGate');
  const nluFirst = G.nluFirstEnabled();
  const nluDecision = nluFirst ? G.nluIntent(text, { profile, doc: sc, topic: v2.lastInfo || null }) : null;
  const callModel = typeof model === 'function' && (!nluFirst || nluDecision.confidence !== 'high');
  if (callModel) mc = await modelCommand({ model, text, sc, lang, timeoutMs });
  const r = M.catalogueTurn(v2, { text, profile, lang, command: mc?.command || null });
  const intentSource = mc?.command ? 'model' : nluFirst && typeof model === 'function' && !callModel ? 'skip' : 'nlu';
  const trace = { step: 'catalogue', lang, kind: r?.kind || null, source: mc?.command ? 'model' : 'nlu', ...(nluFirst ? { intentSource, nlu: nluDecision } : {}), modelMs: mc?.ms ?? null, modelError: mc?.error || null, command: mc?.command || null, scVersion: sc.version, scHash: sc.sourceHash.slice(0, 12), ...(scMeta.stale ? { scStale: true } : {}), ...(scMeta.degraded ? { scDegraded: true } : {}) };
  return r ? { line: r.line, trace } : { line: null, trace: { ...trace, yield: 'not_catalogue' } };
}
module.exports = { looksCatalogue, catalogueStepEnabled, commandSchema, validateCommand, buildCommandRequest, parseCommandResponse, modelCommand, runCatalogueStep };
