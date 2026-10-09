// The provider loop with a mocked @google/genai generateContentStream that
// yields the real response shape (candidates[0].content.parts[].text slices
// of one JSON object, finishReason on the last chunk).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runStructuredGeminiTurn, contentsWithCorrection } = require('../../src/speech/structured/geminiTurn');
const { chunksFromJson, streamOf } = require('../../src/speech/structured/mockStream');
const { formatFactsBlock } = require('../../src/speech/structured/facts');
const { dustedTable, factId } = require('./helpers');

const table = dustedTable();
const HOUSE = factId(table, /^3-Bedroom House/);

function fakeGenAi(replies, { thoughtSignature = 'sig-1' } = {}) {
  const requests = [];
  const generateContentStream = async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)));
    const reply = replies[Math.min(requests.length, replies.length) - 1];
    if (reply instanceof Error) throw reply;
    return streamOf(chunksFromJson(reply, { chunkChars: 11, thoughtSignature }));
  };
  return { generateContentStream, requests };
}

const BASE = {
  contents: [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi, how can I help?', thoughtSignature: 'old' }] },
    { role: 'user', parts: [{ text: 'How much is a 3-bedroom house?' }] },
  ],
  systemPrompt: 'LIVE SYSTEM PROMPT',
  factsBlock: formatFactsBlock(table),
  lock: { lang: 'en', source: 'soniox' },
  table,
  callerText: 'How much is a 3-bedroom house?',
  primary: 'gemini-primary',
  backup: 'gemini-backup',
  timeoutMs: 2000,
  sleep: async () => {},
  env: {},
};

describe('structured Gemini provider loop', () => {
  it('sends responseSchema + JSON mime with the locked lang and grounded facts', async () => {
    const good = { lang: 'en', intent: 'price', facts_used: [{ kind: 'price', id: HOUSE }], say: ['A 3-bedroom house is 6,000 shillings flat.'] };
    const genai = fakeGenAi([good]);
    const said = [];
    const result = await runStructuredGeminiTurn({ ...BASE, ...genai, onSay: (t) => said.push(t) });
    assert.equal(genai.requests.length, 1);
    const { config, model, contents } = genai.requests[0];
    assert.equal(model, 'gemini-primary');
    assert.equal(config.responseMimeType, 'application/json');
    assert.deepEqual(config.responseSchema.properties.lang.enum, ['en']);
    assert.match(config.systemInstruction.parts[0].text, /\[svc:3-bedroom-house\]/);
    assert.equal(contents.length, 3);
    assert.deepEqual(said, ['A 3-bedroom house is 6,000 shillings flat.']);
    assert.equal(result.thoughtSignature, 'sig-1');
    assert.equal(result.llmFailed, false);
  });

  it('the one correction rides on the caller turn, not a new unsigned model turn', async () => {
    const bad = { lang: 'en', intent: 'price', facts_used: [], say: ['It is 9,999 shillings.'] };
    const good = { lang: 'en', intent: 'price', facts_used: [{ kind: 'price', id: HOUSE }], say: ['It is 6,000 shillings flat.'] };
    const genai = fakeGenAi([bad, good]);
    const result = await runStructuredGeminiTurn({ ...BASE, ...genai, onSay: () => {} });
    assert.equal(genai.requests.length, 2);
    const second = genai.requests[1].contents;
    assert.equal(second.length, 3);
    assert.equal(second[2].role, 'user');
    assert.equal(second[2].parts.length, 2);
    assert.match(second[2].parts[1].text, /system correction/);
    assert.equal(result.attempts, 2);
    assert.equal(BASE.contents[2].parts.length, 1, 'caller contents not mutated');
  });

  it('503 before speech retries the primary, then the backup (legacy rule)', async () => {
    const busy = Object.assign(new Error('503 Service Unavailable: model overloaded'), { status: 503 });
    const good = { lang: 'en', intent: 'other', facts_used: [], say: ['Sure, how can I help?'] };
    const genai = fakeGenAi([busy, busy, good]);
    const result = await runStructuredGeminiTurn({ ...BASE, ...genai, onSay: () => {} });
    assert.deepEqual(genai.requests.map((r) => r.model), ['gemini-primary', 'gemini-primary', 'gemini-backup']);
    assert.equal(result.llmFailed, false);
    assert.equal(result.spokenText, 'Sure, how can I help?');
  });

  it('a hard outage stops and reports llmFailed (the server speaks its repair)', async () => {
    const denied = Object.assign(new Error('403 PERMISSION_DENIED denied access'), { status: 403 });
    const genai = fakeGenAi([denied]);
    const result = await runStructuredGeminiTurn({ ...BASE, ...genai, onSay: () => {} });
    assert.equal(genai.requests.length, 1);
    assert.equal(result.llmFailed, true);
    assert.equal(result.spoken.length, 0);
  });

  it('a stalled stream times out per call', async () => {
    const generateContentStream = async () => ({
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}), return: async () => ({ done: true }) };
      },
    });
    const result = await runStructuredGeminiTurn({ ...BASE, generateContentStream, timeoutMs: 30, onSay: () => {} });
    assert.equal(result.llmFailed, true);
    assert.equal(result.timedOut, true);
  });

  it('contentsWithCorrection appends to the last user turn only', () => {
    const out = contentsWithCorrection(BASE.contents, { role: 'user', parts: [{ text: 'fix' }] });
    assert.equal(out[2].parts[1].text, 'fix');
    assert.equal(out[1].parts.length, 1);
  });
});
