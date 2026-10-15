'use strict';
// Real Gemini generateContent transport for v2. The API key is passed in by the
// caller (env at runtime); it is sent only in the x-goog-api-key header and is
// never logged, thrown, or attached to returned objects.
const { callModel } = require('./gemini');

function createGeminiSend({ apiKey, model = 'gemini-3.5-flash-lite', fetchImpl = globalThis.fetch, timeoutMs = 2500, thinkingMinimal = true, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' } = {}) {
  if (!apiKey) throw new Error('gemini transport: apiKey missing');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  return async function send(request) {
    const body = thinkingMinimal ? { ...request, generationConfig: { ...(request.generationConfig || {}), thinkingConfig: { thinkingLevel: 'MINIMAL' } } } : request;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok) { const e = new Error(`gemini http ${res.status}`); e.status = res.status; throw e; }
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') { const x = new Error('gemini timeout'); x.code = 'TIMEOUT'; throw x; }
      const x = new Error(String(e.message || e).split(apiKey).join('[redacted]')); if (e.status) x.status = e.status; throw x;
    } finally { clearTimeout(t); }
  };
}
// Adapter matching runTurn's `model` option: ({request}) => {calls, text}.
// On any transport error returns no calls so the deterministic machine continues.
function createGeminiModel(opts) {
  const send = createGeminiSend(opts); const onError = opts.onError || null;
  return async ({ request }) => { try { return await callModel({ send, request }); } catch (e) { if (onError) onError({ message: e.message, code: e.code, status: e.status }); return { calls: [], text: '', error: e.code || 'error' }; } };
}
module.exports = { createGeminiSend, createGeminiModel };
