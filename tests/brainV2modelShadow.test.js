'use strict';

// C7 BRAIN_V2_MODEL: hybrid Gemini tool-calling in SHADOW. Every model here is a stand-in
// function or a fake fetch: no test makes a network call or reads a key.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const MS = require('../src/conversation/v2/modelShadow');
const { createBrainV2Live, resolveModelShadow } = require('../src/conversation/v2/liveTurn');
const { createGeminiStreamModel } = require('../src/conversation/v2/transport');
const FS = require('../src/knowledge/factStore');
const SA = require('../evals/v2/shadowAgreement');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;

const profile = {
  id: 'tenant-c7',
  businessName: 'Jirani Cleaning Services',
  agentName: 'Wanjiru',
  servicesCatalog: [
    { name: 'Sofa cleaning', price_range: 'From KSh 2,500' },
    { name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500' },
  ],
};
const BASE = { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// stand-in: answers from a script, records each request it was sent
function standIn(script, { delayMs = 5 } = {}) {
  const seen = [];
  let i = 0;
  const fn = async ({ request }) => { seen.push(request); const out = typeof script === 'function' ? script(request, i) : script[i]; i += 1; await sleep(delayMs); return out || { calls: [] }; };
  fn.seen = seen;
  return fn;
}
function liveWith(env, extra = {}) {
  const writes = []; const stages = [];
  const live = createBrainV2Live({ env: { ...BASE, ...env }, applyTools: async (p) => { writes.push(p); return { results: [] }; }, onModelStage: (s) => stages.push(s), traceTurnIndex: () => stages.length, log: () => {}, ...extra });
  return { live, writes, stages };
}
const call = (name, args = {}, thoughtSignature) => ({ calls: [{ name, args, thoughtSignature }], usage: { promptTokenCount: 2400, candidatesTokenCount: 18, cachedContentTokenCount: 0 } });

test('BRAIN_V2_MODEL is off unless set exactly; on is never implied', () => {
  assert.equal(MS.modelMode({}), 'off');
  for (const v of ['1', 'true', 'yes', 'live', 'onn']) assert.equal(MS.modelMode({ BRAIN_V2_MODEL: v }), 'off', v);
  assert.equal(MS.modelMode({ BRAIN_V2_MODEL: 'shadow' }), 'shadow');
  assert.equal(MS.modelMode({ BRAIN_V2_MODEL: 'on' }), 'on');
  assert.equal(resolveModelShadow({ shadowModel: async () => ({}) }, {}), null);
  // shadow without a key (no stand-in) disables itself; it never looks for a key file
  const logs = [];
  assert.equal(resolveModelShadow({ log: (m) => logs.push(m) }, { BRAIN_V2_MODEL: 'shadow' }), null);
  assert.match(logs[0], /no GEMINI_API_KEY/);
});





test('malformed tools are rejected as results', () => {
  const facts = FS.factsFor(profile); const tools = MS.buildTools(facts); const snap = MS.snapshot({});
  const allowed = MS.allowedTools(snap);
  assert.equal(MS.validateProposal({ name: 'make_booking', args: {} }, { tools, facts, snap, allowed }).error, 'unknown_tool');
  assert.equal(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0', when: { date: 'Friday' } } }, { tools, facts, snap, allowed }).error, 'schema_invalid');
  assert.equal(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0', price: 100 } }, { tools, facts, snap, allowed }).error, 'schema_invalid');
  assert.equal(MS.validateProposal({ name: 'propose_order', args: { items: [] } }, { tools, facts, snap, allowed }).error, 'schema_invalid');
  assert.equal(MS.validateProposal({ name: 'end_call', args: { reason: 'done' } }, { tools, facts, snap: { ...snap, phase: 'readback', pendingTool: 'create_booking' }, allowed: MS.allowedTools({ phase: 'readback', pendingTool: 'create_booking' }) }).error, 'not_allowed_in_state');
});


test('a proposal without the confirm token never commits; a wrong token is token_mismatch', () => {
  const facts = FS.factsFor(profile); const tools = MS.buildTools(facts);
  const rb = { phase: 'readback', pendingTool: 'create_booking', pendingToken: 'ct_abc123' };
  const allowed = MS.allowedTools(rb);
  assert.deepEqual(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0' } }, { tools, facts, snap: rb, allowed }), { ok: true, commit: false });
  assert.equal(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0', confirm_token: 'ct_zzz999' } }, { tools, facts, snap: rb, allowed }).error, 'token_mismatch');
  assert.equal(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0', confirm_token: 'ct_abc123' } }, { tools, facts, snap: { phase: 'collect' }, allowed: MS.allowedTools({}) }).error, 'token_mismatch');
  assert.deepEqual(MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_0', confirm_token: 'ct_abc123' } }, { tools, facts, snap: rb, allowed }), { ok: true, commit: true });
});



test('redaction keeps ISO dates and drops phone numbers', () => {
  assert.equal(MS.redact('2026-10-23'), '2026-10-23');
  assert.equal(MS.redact('call 0712 345 678 or +254712345678'), 'call [phone] or [phone]');
});

test('per-state tools: nothing after the end; read-back allows its write and reads, not end_call', () => {
  assert.deepEqual(MS.allowedTools({ ended: true }), []);
  const rb = MS.allowedTools({ phase: 'readback', pendingTool: 'create_order' });
  assert.equal(rb[0], 'propose_order');
  assert.ok(!rb.includes('end_call') && !rb.includes('propose_booking'));
  const req = MS.buildModelRequest({ text: 'x', snap: MS.snapshot({ ended: true }), facts: {}, allowed: [], tools: MS.buildTools({}) });
  assert.equal(req.toolConfig.functionCallingConfig.mode, 'NONE');
  assert.equal(req.tools, undefined);
});

test('streaming transport: SSE parts, thoughtSignature, usage; key only in the header; abort is a timeout', async () => {
  const sse = [
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_price","args":{"service_id":"svc_0"}},"thoughtSignature":"sig-1"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"ignored"}]}}],"usageMetadata":{"promptTokenCount":2500,"candidatesTokenCount":12}}\n\n',
  ];
  let seenUrl; let seenHeaders;
  const fetchImpl = async (url, init) => {
    seenUrl = url; seenHeaders = init.headers;
    const enc = new TextEncoder(); let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < sse.length ? { value: enc.encode(sse[i++]), done: false } : { done: true }) }) } };
  };
  const m = createGeminiStreamModel({ apiKey: 'test-key-not-real', model: 'stand-in', fetchImpl });
  const out = await m({ request: {} });
  assert.match(seenUrl, /:streamGenerateContent\?alt=sse$/);
  assert.doesNotMatch(seenUrl, /test-key/);
  assert.equal(seenHeaders['x-goog-api-key'], 'test-key-not-real');
  assert.deepEqual(out.calls, [{ name: 'get_price', args: { service_id: 'svc_0' }, thoughtSignature: 'sig-1' }]);
  assert.equal(out.usage.promptTokenCount, 2500);
  // abort under the cap
  const hang = createGeminiStreamModel({ apiKey: 'test-key-not-real', fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const r = await MS.capped(hang, {}, 50);
  assert.equal(r.timedOut, true);
  const failing = createGeminiStreamModel({ apiKey: 'test-key-not-real', fetchImpl: async () => { throw new Error('connect failed test-key-not-real'); } });
  await assert.rejects(failing({ request: {} }), (e) => !String(e.message).includes('test-key-not-real'));
});

test('on mode exists only when set exactly, and hands the capped model to the unclear-turn hook', async () => {
  const model = standIn(() => ({ calls: [] }));
  const { live } = liveWith({ BRAIN_V2_MODEL: 'on' }, { shadowModel: model });
  const out = await live.run({ text: 'which services do you offer?', profile, langLock: 'en' });
  assert.ok(out.line);
  assert.equal(resolveModelShadow({ shadowModel: model }, { BRAIN_V2_MODEL: 'ON ' }).mode, 'on');
});

test('voice trace: the model stage lands on the turn row (before or after commit), redacted', async () => {
  const { createVoiceTrace } = require('../src/speech/voiceTrace');
  const rows = []; const updates = [];
  const tr = createVoiceTrace({ enabled: true, callId: 'HD_c7', tenantId: null, sink: { write: (r) => rows.push(JSON.parse(JSON.stringify(r))), update: (r) => updates.push(JSON.parse(JSON.stringify(r))) } });
  tr.beginTurn({ callerText: 'hi', language: { current: 'en' } });
  const idx = tr.currentTurnIndex();
  tr.noteBrainV2Model({ stage: 'brain_v2_model', turnIndex: idx, proposal: { args: { name: 'call 0712345678', when: { date: '2026-10-23' } } }, thoughtSignature: true, agree: true });
  tr.commitTurn({ outcome: 'ok' });
  const st = rows[0].stages.find((s) => s.stage === 'brain_v2_model');
  assert.ok(st); assert.equal(st.agree, true);
  assert.doesNotMatch(JSON.stringify(st), /0712345678/);
  assert.equal(st.proposal.args.when.date, '2026-10-23');
  tr.beginTurn({ callerText: 'next', language: { current: 'en' } }); const idx2 = tr.currentTurnIndex(); tr.commitTurn({ outcome: 'ok' });
  tr.noteBrainV2Model({ stage: 'brain_v2_model', turnIndex: idx2, agree: false });
  await tr.finishCall();
  const up = updates.find((u) => u.turnIndex === idx2);
  assert.ok(up && up.stages.some((s) => s.stage === 'brain_v2_model' && s.agree === false));
});

test('eval:v2:shadow-agreement reports agreement by intent, p50/p95 and cost', () => {
  const fs = require('node:fs');
  const rows = SA.rowsOf(fs.readFileSync(path.join(__dirname, '..', 'evals', 'v2', 'fixtures', 'shadow-agreement.jsonl'), 'utf8'));
  const r = SA.report(rows.flatMap(SA.stagesOf));
  assert.equal(r.turns, 24);
  assert.equal(r.byIntent.book.n, 8);
  assert.equal(r.latency.p50, 440);
  assert.equal(r.latency.p95, 940);
  assert.equal(r.gate.pass, false);
  assert.ok(r.cost.perCallUsd > 0 && r.cost.perCallUsd < 0.02);
  const good = SA.report(Array.from({ length: 20 }, () => ({ stage: 'brain_v2_model', rules: { intent: 'book' }, agree: true, latencyMs: 500, tokens: { costUsd: 0.0008 } })));
  assert.equal(good.gate.pass, true);
});

test('streaming transport: CRLF-framed SSE (as Gemini sends it), split across chunks, still yields calls + usage', async () => {
  const body = 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_price","args":{"service_id":"svc_0"}}}]}}]}\r\n\r\n'
    + 'data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\r\n\r\n';
  const cut = body.indexOf('\r\n\r\n') + 1; // chunk boundary between \r and \n
  const chunks = [body.slice(0, cut), body.slice(cut)];
  const enc = new TextEncoder(); let i = 0;
  const fetchImpl = async () => ({ ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true }) }) } });
  const out = await createGeminiStreamModel({ apiKey: 'test-key-not-real', model: 'stand-in', fetchImpl })({ request: {} });
  assert.deepEqual(out.calls, [{ name: 'get_price', args: { service_id: 'svc_0' }, thoughtSignature: undefined }]);
  assert.equal(out.usage.candidatesTokenCount, 3);
  const { parseSse } = require('../src/conversation/v2/transport');
  const evs = []; parseSse(body, (e) => evs.push(e));
  assert.equal(evs.length, 2);
});
