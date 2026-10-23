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
// C7 (BRAIN_V2_MODEL): streaming generateContent (SSE) with native function calling. The caller's
// AbortSignal is the 900 ms hard cap (modelShadow.capped). Returns {calls, text, usage}; function-call
// parts keep their thoughtSignature so the next turn can pass it back. Key only in the header.
function parseSse(buf, onEvent) {
  let i;
  buf = buf.replace(/\r\n?/g, '\n'); // Gemini frames SSE with CRLF (\r\n\r\n); normalise CRLF/CR to LF before splitting
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (data && data !== '[DONE]') { try { onEvent(JSON.parse(data)); } catch (e) { console.warn('[brain_v2_model] sse parse failed', { len: data.length, err: e.message }); } }
  }
  return buf;
}
function createGeminiStreamModel({ apiKey, model = 'gemini-3.5-flash-lite', fetchImpl = globalThis.fetch, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' } = {}) {
  if (!apiKey) throw new Error('gemini transport: apiKey missing');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  return async function streamModel({ request, signal } = {}) {
    const calls = []; let text = ''; let usage = null;
    const onEvent = (ev) => {
      for (const p of ev?.candidates?.[0]?.content?.parts || []) {
        if (p.functionCall) calls.push({ name: p.functionCall.name, args: p.functionCall.args || {}, thoughtSignature: p.thoughtSignature || undefined });
        else if (typeof p.text === 'string' && !p.thought) text += p.text;
        else if (p.thoughtSignature && calls.length) calls[calls.length - 1].thoughtSignature = calls[calls.length - 1].thoughtSignature || p.thoughtSignature;
      }
      if (ev?.usageMetadata) usage = ev.usageMetadata;
    };
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(request), signal });
    } catch (e) {
      const x = new Error(e?.name === 'AbortError' ? 'gemini timeout' : String(e?.message || e).split(apiKey).join('[redacted]')); x.code = e?.name === 'AbortError' ? 'TIMEOUT' : 'network'; throw x;
    }
    if (!res.ok) { const e = new Error(`gemini http ${res.status}`); e.status = res.status; e.code = `http_${res.status}`; throw e; }
    let buf = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const rd = res.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf = parseSse(buf + dec.decode(value, { stream: true }), onEvent); }
    } else buf = parseSse(String(await res.text()), onEvent);
    parseSse(`${buf}\n\n`, onEvent);
    return { calls, text, usage };
  };
}
module.exports = { createGeminiSend, createGeminiModel, createGeminiStreamModel, parseSse };
