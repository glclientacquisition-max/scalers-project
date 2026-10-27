'use strict';
// AI pass transport for the spoken catalogue: request shape and error codes. Mocked fetch only; never calls Gemini.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/knowledge/spokenCatalogueOnSave');
const { createSpokenCatalogueGenerate, buildRequest, errorCode } = require('../src/knowledge/spokenCatalogueGenerate');
const { AI_SCHEMA } = require('../src/knowledge/spokenCatalogue');

const TID = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
const ON = { SPOKEN_CATALOGUE_ON_SAVE: '1' };
const KEY = 'test-key-not-real';
const row = () => ({ id: TID, services_catalog: [{ name: 'Sofa Cleaning (per seat)', price_range: 'KSh 800' }, { name: 'Carpet Cleaning (per room)', notes: 'Shampoo, dry' }], product_catalog: [], service_areas: null, business_locations: [], spoken_catalogue: null });
function rpcDb(r) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push(args); r.spoken_catalogue = args.p_doc; return { error: null }; },
    from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: JSON.parse(JSON.stringify(r)), error: null }) }; return c; } };
}
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const quiet = { log: () => {} };

test('request: responseMimeType application/json + responseJsonSchema (JSON Schema), no deprecated responseSchema', async () => {
  let seen;
  const gen = createSpokenCatalogueGenerate({ apiKey: KEY, model: 'gemini-3.6-flash', fetchImpl: async (url, init) => { seen = { url, init }; return res(200, { candidates: [{ content: { parts: [{ text: '{"entries":[]}' }] } }] }); } });
  await gen({ prompt: 'p', schema: AI_SCHEMA });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseJsonSchema, AI_SCHEMA);
  assert.equal('responseSchema' in body.generationConfig, false);
  assert.equal('thinkingConfig' in body.generationConfig, false);
  assert.deepEqual(buildRequest({ prompt: 'x', schema: AI_SCHEMA }).contents, [{ role: 'user', parts: [{ text: 'x' }] }]);
});

test('Gemini 400 is stored as compile_error http_400 (no body text), rules saved', async () => {
  const r = row(); const db = rpcDb(r);
  const generate = createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl: async () => res(400, { error: { message: 'Invalid JSON payload received. Unknown name "type" Sofa Cleaning' } }) });
  const out = await S.runSpokenCatalogueCompile(TID, { db, env: ON, generate, ...quiet });
  assert.equal(out.ok, true); assert.equal(out.generator, 'rules'); assert.equal(out.aiError, 'http_400');
  assert.equal(db.calls[0].p_compile_error, 'http_400');
  assert.ok(db.calls[0].p_compile_error.length <= 200);
});

test('valid Gemini response gives generator ai+rules and no compile_error', async () => {
  const r = row(); const db = rpcDb(r);
  const fetchImpl = async (_u, init) => {
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    const rows = JSON.parse(prompt.split('\n').pop());
    const entries = rows.map((x) => ({ id: x.id, name_en: /sofa/i.test(x.name) ? 'sofa cleaning' : 'carpet cleaning', name_sw: /sofa/i.test(x.name) ? 'usafi wa sofa' : 'usafi wa zulia', explain_en: 'We clean it at your home.', explain_sw: 'Tunasafisha nyumbani kwako.' }));
    return res(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ entries }) }] } }] });
  };
  const out = await S.runSpokenCatalogueCompile(TID, { db, env: ON, generate: createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl }), ...quiet });
  assert.equal(out.ok, true); assert.equal(out.generator, 'ai+rules'); assert.equal(out.aiError, null);
  assert.equal(db.calls[0].p_compile_error, null);
});

test('error classes: no_key, bad_json, schema_invalid, timeout, http_<status>', async () => {
  const ok = (text) => async () => res(200, { candidates: [{ content: { parts: [{ text }] } }] });
  const code = async (gen) => { try { await gen({ prompt: 'p', schema: AI_SCHEMA }); return null; } catch (e) { return S.aiCode(e.message); } };
  assert.equal(await code(createSpokenCatalogueGenerate({ apiKey: '' })), 'no_key');
  assert.equal(await code(createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl: ok('Sofa Cleaning is nice') })), 'bad_json');
  assert.equal(await code(createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl: ok('{"items":[]}') })), 'schema_invalid');
  assert.equal(await code(createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl: async () => res(503, {}) })), 'http_503');
  const abortFetch = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal(await code(createSpokenCatalogueGenerate({ apiKey: KEY, timeoutMs: 5, fetchImpl: abortFetch })), 'timeout');
  assert.equal(errorCode(new Error('Unexpected token S in "Sofa"')), 'generate_failed');
  // the timeout wrapper keeps the class
  await assert.rejects(S.withTimeout(createSpokenCatalogueGenerate({ apiKey: KEY, fetchImpl: async () => res(400, {}) }), 1000)({ prompt: 'p', schema: AI_SCHEMA }), /^Error: http_400$/);
});
