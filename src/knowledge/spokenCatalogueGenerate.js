'use strict';
// Gemini generate() for the spoken catalogue AI pass (on-save + backfill).
// Request follows the current generateContent docs: responseMimeType
// application/json + responseJsonSchema (standard JSON Schema, lowercase types).
// The old code sent the JSON Schema in the deprecated `responseSchema` field,
// which expects the OpenAPI Schema subset (enum Type: OBJECT/STRING/...), so
// Gemini rejected it instantly with HTTP 400.
// Every failure throws an Error whose message is a short code only (never body
// text, never the key): no_key | http_<status> | timeout | bad_json | schema_invalid | network.
const { createGeminiSend } = require('../conversation/v2/transport');

const codeErr = (code) => Object.assign(new Error(code), { code });

function errorCode(e) {
  if (e == null) return null;
  const c = e.code || e.message || String(e);
  if (/^(no_key|timeout|bad_json|schema_invalid|network|http_\d{3})$/.test(c)) return c;
  if (e.status) return `http_${Number(e.status) || 'error'}`;
  if (e.code === 'TIMEOUT' || /timeout/i.test(String(e.message || e))) return 'timeout';
  const m = /http (\d{3})/.exec(String(e.message || e));
  if (m) return `http_${m[1]}`;
  return 'generate_failed';
}

function buildRequest({ prompt, schema }) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: schema },
  };
}

function createSpokenCatalogueGenerate({ apiKey, model = 'gemini-3.5-flash', timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return async () => { throw codeErr('no_key'); };
  const send = createGeminiSend({ apiKey: key, model, timeoutMs, thinkingMinimal: false, fetchImpl });
  return async ({ prompt, schema }) => {
    let resp;
    try { resp = await send(buildRequest({ prompt, schema })); } catch (e) { throw codeErr(e.status ? `http_${e.status}` : e.code === 'TIMEOUT' ? 'timeout' : 'network'); }
    const text = (resp?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    let out;
    try { out = JSON.parse(text); } catch { throw codeErr('bad_json'); }
    if (!out || !Array.isArray(out.entries)) throw codeErr('schema_invalid');
    return out;
  };
}

module.exports = { createSpokenCatalogueGenerate, buildRequest, errorCode };
