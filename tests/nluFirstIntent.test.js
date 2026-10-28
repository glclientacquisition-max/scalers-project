'use strict';
// VOICE_NLU_FIRST_INTENT / VOICE_INTENT_IN_MAIN_TURN (both default off).
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/conversation/v2/intentGate');
const C = require('../src/conversation/v2/catalogueStep');
const SC = require('../src/knowledge/spokenCatalogue');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const doc = SC.compileSync(DD);
function withEnv(env, fn) {
  const prev = {}; for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  return Promise.resolve().then(fn).finally(() => { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}
function fakeModel(command) { const m = async () => { m.calls += 1; return { candidates: [{ content: { parts: [{ text: JSON.stringify(command) }] } }] }; }; m.calls = 0; return m; }

test('flags default off', () => {
  assert.equal(G.nluFirstEnabled({}), false);
  assert.equal(G.intentInMainTurnEnabled({ VOICE_INTENT_IN_MAIN_TURN: '1' }), false, 'sub-flag needs the parent flag');
});

test('nluIntent: clear list_services and bound price are high; unbound explain / conflict are low', () => {
  const l = G.nluIntent('Niulize, ni services gani mna- mna offer?', { profile: DD, doc });
  assert.deepEqual({ intent: l.intent, service_id: l.service_id, confidence: l.confidence, reason: l.reason }, { intent: 'list_services', service_id: null, confidence: 'high', reason: 'services' });
  assert.equal(l.clear, true); assert.ok(l.score >= 0.8 && l.score <= 1); // Brain nlu confidence passed through
  const p = G.nluIntent('Nilikuwa nataka kujua bei ya kuosha carpet', { profile: DD, doc });
  assert.equal(p.intent, 'price_service'); assert.equal(p.confidence, 'high'); assert.equal(p.service_id, doc.entries.find((e) => /carpet/i.test(e.raw.name)).id);
  assert.equal(G.nluIntent('Hebu niambie kuhusu hiyo usafi wa apartment', { profile: DD, doc }).confidence, 'low');
  assert.equal(G.nluIntent('Hebu niambie kuhusu hiyo usafi wa apartment', { profile: DD, doc }).reason, 'no_service_id');
});

test('flag off: the model classify runs as before (intentSource not traced)', async () => {
  await withEnv({ VOICE_NLU_FIRST_INTENT: null }, async () => {
    const m = fakeModel({ intent: 'list_services', language: 'sw' });
    const r = await C.runCatalogueStep({ text: 'Niulize, ni services gani mna offer?', profile: DD, lang: 'sw', state: {}, model: m });
    assert.equal(m.calls, 1); assert.equal('intentSource' in r.trace, false);
  });
});

test('flag on: clear list_services skips the model (intentSource=skip), same line as nlu', async () => {
  await withEnv({ VOICE_NLU_FIRST_INTENT: '1' }, async () => {
    const m = fakeModel({ intent: 'list_services', language: 'sw' });
    const r = await C.runCatalogueStep({ text: 'Niulize, ni services gani mna offer?', profile: DD, lang: 'sw', state: {}, model: m });
    assert.equal(m.calls, 0); assert.equal(r.trace.intentSource, 'skip'); assert.equal(r.trace.modelMs, null);
    const base = await C.runCatalogueStep({ text: 'Niulize, ni services gani mna offer?', profile: DD, lang: 'sw', state: {}, model: null });
    assert.equal(r.line, base.line);
  });
});

test('flag on: explain without a bound service calls the model (intentSource=model)', async () => {
  await withEnv({ VOICE_NLU_FIRST_INTENT: '1' }, async () => {
    const id = doc.entries.find((e) => /2-Bedroom/i.test(e.raw.name)).id;
    const m = fakeModel({ intent: 'explain_service', service_id: id, language: 'sw' });
    const state = {};
    await C.runCatalogueStep({ text: 'Niulize, ni services gani mna offer?', profile: DD, lang: 'sw', state, model: null });
    const r = await C.runCatalogueStep({ text: 'Hebu niambie kuhusu hiyo usafi wa apartment', profile: DD, lang: 'sw', state, model: m });
    assert.equal(m.calls, 1); assert.equal(r.trace.intentSource, 'model'); assert.equal(r.trace.nlu.confidence, 'low');
  });
});

test('flag on: model failure on a low-confidence turn falls back to nlu (intentSource=nlu)', async () => {
  await withEnv({ VOICE_NLU_FIRST_INTENT: '1' }, async () => {
    const m = async () => { throw new Error('timeout'); };
    const state = {};
    await C.runCatalogueStep({ text: 'what services do you offer?', profile: DD, lang: 'en', state, model: null });
    const r = await C.runCatalogueStep({ text: 'tell me about the apartment one', profile: DD, lang: 'en', state, model: m });
    assert.equal(r.trace.intentSource, 'nlu'); assert.ok(r.trace.modelError);
  });
});

test('VOICE_INTENT_IN_MAIN_TURN: folded command parsed from ###TOOL###, never spoken, validated against the doc', () => {
  const id = doc.entries[0].id;
  const raw = `Tunafanya usafi wa magodoro. ###TOOL### {"catalogue_intent": {"intent": "list_services", "service_id": null}} ###ENDTOOL###`;
  const parsed = parseGeminiResponse(raw);
  assert.doesNotMatch(parsed.spokenText, /catalogue_intent|###/);
  assert.deepEqual(G.foldedFromParsed(parsed, doc), { intent: 'list_services', service_id: null });
  assert.deepEqual(G.foldedFromParsed(parseGeminiResponse(`ok ###TOOL### {"catalogue_intent": {"intent": "price_service", "service_id": "${id}"}} ###ENDTOOL###`), doc), { intent: 'price_service', service_id: id });
  assert.deepEqual(G.foldedFromParsed(parseGeminiResponse('ok ###TOOL### {"catalogue_intent": {"intent": "buy_now"}} ###ENDTOOL###'), doc), { invalid: true });
  assert.equal(G.foldedFromParsed(parseGeminiResponse('no tool here'), doc), null);
  assert.match(G.foldInstruction(doc), /catalogue_intent/); assert.match(G.foldInstruction(doc), new RegExp(id));
});

// B2: the intent fold was a log-only shadow inside the old Gemini turn; it is deleted with that turn.
test('server wiring (B2): the old turn\'s intent-fold shadow is gone', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /intentGate\.intentInMainTurnEnabled\(\)|function logFoldedIntent|intent_fold/);
});
