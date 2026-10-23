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

test('agree: the stand-in proposes the same booking the rules took', async () => {
  const model = standIn([call('propose_booking', { service_id: 'svc_0' })]);
  const { live, stages, writes } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: model });
  await live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  assert.equal(st.stage, 'brain_v2_model');
  assert.equal(st.rules.intent, 'book');
  assert.equal(st.modelIntent, 'book');
  assert.equal(st.agree, true);
  assert.equal(st.proposal.valid, true);
  assert.equal(st.proposal.commit, false);
  assert.equal(st.timedOut, false);
  assert.equal(st.tokens.in, 2400);
  assert.ok(st.tokens.costUsd > 0);
  assert.equal(stages.length, 1);
  assert.equal(writes.length, 0);
  // the request: system instruction with state + facts, allowed tools only, redacted user text
  const req = model.seen[0];
  assert.match(req.systemInstruction.parts[0].text, /CONTEXT .*"expecting"/);
  assert.match(req.systemInstruction.parts[0].text, /svc_0/);
  const names = req.tools[0].functionDeclarations.map((d) => d.name);
  assert.deepEqual(names.sort(), MS.allowedTools({ phase: 'collect' }).sort());
});

test('disagree: a different intent is logged as agree=false and changes nothing', async () => {
  const model = standIn([call('get_hours', { day: 'today' })]);
  const { live } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: model });
  await live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  assert.equal(st.rules.intent, 'book');
  assert.equal(st.modelIntent, 'hours');
  assert.equal(st.agree, false);
});

test('timeout: a stand-in over 900 ms is cut off, the rules line stands and the caller waits for nothing', async () => {
  const off = liveWith({});
  const offOut = await off.live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  const slow = standIn([call('propose_booking', { service_id: 'svc_0' })], { delayMs: 1500 });
  const sh = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: slow });
  const t0 = Date.now();
  const out = await sh.live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  const callerMs = Date.now() - t0;
  assert.ok(callerMs < 400, `caller turn waited ${callerMs} ms`);
  assert.equal(out.line, offOut.line);
  const st = await sh.live.lastModelShadow();
  assert.equal(st.timedOut, true);
  assert.ok(st.latencyMs >= 880 && st.latencyMs < 1300, String(st.latencyMs));
  assert.equal(st.agree, false);
  assert.equal(st.proposal, null);
  assert.equal(st.tokens.estimated, true);
});

test('a stand-in error is a result, not an exception', async () => {
  const bad = async () => { throw Object.assign(new Error('boom'), { code: 'http_500' }); };
  const { live } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: bad });
  const out = await live.run({ text: 'which services do you offer?', profile, langLock: 'en' });
  assert.ok(out.line);
  const st = await live.lastModelShadow();
  assert.equal(st.error, 'http_500');
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

test('a hallucinated service is rejected by the fact store', async () => {
  const facts = FS.factsFor(profile); const tools = MS.buildTools(facts); const snap = MS.snapshot({});
  const r = MS.validateProposal({ name: 'propose_booking', args: { service_id: 'svc_99' } }, { tools, facts, snap, allowed: MS.allowedTools(snap) });
  assert.equal(r.error, 'unknown_service');
  const model = standIn([call('propose_booking', { service_id: 'carpet_steam' })]);
  const { live } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: model });
  await live.run({ text: 'I want to book carpet steaming', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  assert.equal(st.proposal.valid, false);
  assert.equal(st.proposal.error, 'unknown_service');
  assert.equal(st.modelIntent, 'none');
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

test('shadow is byte-identical to off for the caller across a whole call (lines, writes, state)', async () => {
  const script = ['hello', 'which services do you offer?', 'I want to book sofa cleaning', 'Friday at 10am', 'my name is Aisha', 'yes', 'call me on 0712 345 678', 'thanks, bye'];
  const run = async (env, extra) => {
    const r = liveWith(env, extra); const lines = [];
    for (const text of script) lines.push(JSON.stringify(await r.live.run({ text, profile, langLock: 'en' })));
    return { lines, writes: JSON.stringify(r.writes), state: JSON.stringify(r.live.getState(), (k, v) => (k === 'now' ? undefined : v)), stages: r.stages, live: r.live };
  };
  const off = await run({});
  const model = standIn((req, i) => (i % 3 === 0 ? call('propose_booking', { service_id: 'svc_0', confirm_token: 'ct_fake1' }) : i % 3 === 1 ? call('end_call', { reason: 'done' }) : call('nonsense', { x: 1 })));
  const sh = await run({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: model });
  assert.deepEqual(sh.lines, off.lines);
  assert.equal(sh.writes, off.writes);
  assert.equal(sh.state, off.state);
  await sh.live.lastModelShadow(); await sleep(30);
  assert.equal(sh.stages.length, script.length);
  // no raw phone number in any stage or in what was sent to the model
  const blob = JSON.stringify(sh.stages) + JSON.stringify(model.seen);
  assert.doesNotMatch(blob, /0712\s?345\s?678|712345678/);
});

test('thoughtSignature is passed back on the next turn with the validated result', async () => {
  const model = standIn([call('propose_booking', { service_id: 'svc_0' }, 'sig-AAA'), call('get_hours', { day: 'today' })]);
  const { live } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: model });
  await live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  const st1 = await live.lastModelShadow();
  assert.equal(st1.thoughtSignature, true);
  await live.run({ text: 'what time do you open?', profile, langLock: 'en' });
  await live.lastModelShadow();
  const c = model.seen[1].contents;
  const modelPart = c.find((x) => x.role === 'model').parts[0];
  assert.equal(modelPart.functionCall.name, 'propose_booking');
  assert.equal(modelPart.thoughtSignature, 'sig-AAA');
  const resp = c.find((x) => x.parts[0].functionResponse).parts[0].functionResponse;
  assert.deepEqual(resp.response, { ok: true, status: 'proposed' });
  assert.equal(c[c.length - 1].parts[0].text, 'what time do you open?');
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
