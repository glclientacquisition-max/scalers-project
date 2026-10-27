'use strict';
// Native Gemini function calling adapter for BA v2. Builds the request body
// (tools.functionDeclarations + toolConfig) and parses functionCall parts.
// The transport is injected (`send`) so evals and tests mock the model.
const { toFunctionDeclarations } = require('./catalogue');

function buildRequest({ systemInstruction, history = [], userText, catalogue, toolMode = 'AUTO', allowed = null }) {
  const fcc = { mode: toolMode };
  if (toolMode === 'ANY' && allowed?.length) fcc.allowedFunctionNames = allowed;
  return {
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    contents: [...history, { role: 'user', parts: [{ text: String(userText || '') }] }],
    tools: toolMode === 'NONE' ? undefined : [{ functionDeclarations: toFunctionDeclarations(catalogue) }],
    toolConfig: { functionCallingConfig: fcc },
    generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
  };
}
// Returns { calls:[{name,args,thoughtSignature?}], text } from a generateContent response.
function parseResponse(resp) {
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  const calls = []; let text = '';
  for (const p of parts) {
    if (p.functionCall) calls.push({ name: p.functionCall.name, args: p.functionCall.args || {}, thoughtSignature: p.thoughtSignature });
    else if (typeof p.text === 'string') text += p.text;
  }
  return { calls, text };
}
async function callModel({ send, request }) { const resp = await send(request); return parseResponse(resp); }
module.exports = { buildRequest, parseResponse, callModel };
