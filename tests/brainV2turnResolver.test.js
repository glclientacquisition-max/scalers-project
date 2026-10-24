'use strict';
// brain/turn-resolver-v1-model-call: resolver + playbook + composer (R1/R2/M1), the one-call turn
// model (M2-M5) and the L1 first-audio harness. Stand-in models only: no network, no key.
process.env.BRAIN_V2_FACT_STORE = 'on'; process.env.BRAIN_V2_NLU_GAPS = 'on'; process.env.VOICE_V2_CATALOGUE = 'on';
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V2 = require('../src/conversation/v2');
const TR = require('../src/conversation/v2/turnResolver');
const TM = require('../src/conversation/v2/turnModel');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const NOW = new Date('2026-10-24T06:05:00Z');
const H = { createAppointment: async () => ({ id: 'a' }), updateAppointment: async () => ({ id: 'a' }), createServiceRequest: async () => ({ id: 's' }), escalate: async () => ({ ok: true }), saveCallerInfo: async () => ({ ok: true }) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function replay(lines, extra = {}) {
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [] });
  const out = [];
  for (const text of lines) out.push((await V2.runTurn(st, { text, profile: DD, now: NOW, handlers: H, ...extra })).line);
  return { st, out };
}
const svc = (re) => DD.servicesCatalog.find((s) => re.test(s.name));
const note = (args) => ({ name: 'note_turn', args });
// stand-in stream model: streams the note_turn call through onCall after delayMs; honours abort
function streamStandIn({ delayMs = 20, args = {}, fail = null } = {}) {
  const seen = [];
  const fn = async ({ request, signal, onCall }) => {
    seen.push(request);
    await new Promise((res, rej) => { const t = setTimeout(res, typeof delayMs === 'function' ? delayMs(seen.length) : delayMs); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('gemini timeout'), { code: 'TIMEOUT' })); }, { once: true }); });
    if (fail) { const f = typeof fail === 'function' ? fail(seen.length) : fail; if (f) throw f; }
    const c = note(typeof args === 'function' ? args(request) : args); onCall?.(c);
    return { calls: [c], usage: { promptTokenCount: 900, cachedContentTokenCount: 700, candidatesTokenCount: 12 } };
  };
  fn.seen = seen;
  return fn;
}

test('R1 HD_87f73ce7003b: Kisumu -> out of area + callback; explain with no description -> category + callback', async () => {
  const { st, out } = await replay(['Uh, I also— I want— I want you to come to Kisumu to my place for some window cleaning, and then I want you to tell me more about the window cleaning and how you do it exactly. Is it possible?']);
  const line = out[0];
  assert.match(line, /don't cover Kisumu/i);
  assert.match(line, /window cleaning, but I don't have the details/i);
  assert.match(line, /call you back/i);
  assert.ok(!/^\s*(interior window cleaning)\.?\s*$/i.test(line), 'no bare label');
  assert.equal(st.offer, 'callback');
  assert.equal((line.match(/\?/g) || []).length, 1, 'one offer');
});

test('R2 HD_a17139a56f0b: no repair loop on "Really?"; price ask never gets a coverage list', async () => {
  const { out } = await replay(['Could do earlier post-construction in a cage.', 'How much is post-construction cleaning?', 'Really?', 'Is it really— Is it really 40 shillings?', 'Is the post-construction cleaning— is it really 40 shillings?']);
  for (const l of out.slice(2)) {
    assert.match(l, /forty shillings|40/i, l);
    assert.ok(!/didn't catch|say that again|sikusikia/i.test(l), `repair: ${l}`);
    assert.ok(!/we serve|we cover/i.test(l), `coverage list: ${l}`);
  }
});

test('M1 multi-ask: explain + price + possible each resolved, fixed order, one offer', async () => {
  const pc = svc(/post-construction/i);
  const { st, out } = await replay(['How is post-construction cleaning done, how much is it, and is it possible?'], { turnFields: { asks: ['explain', 'price', 'possible'], service_id: pc.id } });
  const tr = st.trace.find((t) => t.resolver);
  assert.deepEqual(tr.resolver.resolutions.map((r) => r.split(':')[0]).sort(), ['explain', 'possible', 'price']);
  const l = out[0];
  assert.match(l, /building or renovation/i, 'explain from the confirmed description');
  assert.match(l, /forty shillings|40/i);
  assert.ok(l.search(/renovation/i) < l.search(/forty|40/i), 'explain before price');
  assert.match(l, /Would you like to book\?$/);
  assert.equal((l.match(/\?/g) || []).length, 1);
});

test('collectAsks keeps a model place only if the caller said it, and a service id only if it is a catalogue row', () => {
  const u = { intents: ['price'] };
  const a = TR.collectAsks({ u, text: 'how much', profile: DD, fields: { asks: ['price'], place: 'Mombasa', service_id: 'svc_nope' } });
  assert.equal(a.place, null);
  assert.equal(a.service, null);
  const w = svc(/window/i);
  const b = TR.collectAsks({ u, text: 'how much in Kisumu', profile: DD, fields: { asks: ['price'], place: 'Kisumu', service_id: w.id } });
  assert.equal(b.place.text, 'Kisumu');
  assert.equal(b.service.id, w.id);
});

test('M2 model timeout: v1 policy (retry once after 400 ms, backup on busy), cap not raised; reply from rules', async () => {
  assert.deepEqual(TM.nextAttempt({ err: { code: 'TIMEOUT' }, attempt: 0 }).action, 'retry');
  assert.equal(TM.nextAttempt({ err: { code: 'TIMEOUT' }, attempt: 0 }).waitMs, 400);
  assert.equal(TM.nextAttempt({ err: { status: 503 }, attempt: 1 }).action, 'backup');
  assert.equal(TM.nextAttempt({ err: { code: 'TIMEOUT' }, attempt: 1 }).action, 'stop');
  assert.equal(TM.nextAttempt({ err: { status: 403 }, attempt: 0 }).action, 'stop');
  assert.equal(require('../src/conversation/v2/modelShadow').HARD_CAP_MS, 1800);
  const stages = [];
  const dead = streamStandIn({ delayMs: 10, fail: { status: 503, code: 'http_503' } });
  const tm = TM.createTurnModel({ streamFor: () => dead, primaryId: 'p', backupId: 'b', capMs: 1800, onStage: (s) => stages.push(s), sleep: () => Promise.resolve() });
  const r = await tm.forFinal({ text: 'how much is sofa', profile: DD, budgetMs: 1800 });
  assert.equal(r.fields, null);
  assert.deepEqual(r.stage.attempts.map((a) => `${a.model}:${a.outcome}`), ['p:unavailable', 'p:unavailable', 'b:unavailable']);
  assert.equal(stages.length, 1);
  // live: an always-failing model still gives the rules reply, no model text
  const live = createBrainV2Live({ env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on' }, shadowModel: dead, applyTools: async () => ({ results: [] }), log: () => {}, callSid: 'm2', turnModelWaitMs: 300 });
  const out = await live.run({ text: 'How much is post-construction cleaning?', profile: DD, langLock: 'en' });
  assert.match(out.line, /forty|40/i);
  TM.endCall('m2');
});

test('M3 one model request per turn, started on the partial; a changed text cancels the stale call', async () => {
  const w = svc(/window/i);
  const m = streamStandIn({ delayMs: 60, args: { asks: ['explain'], service_id: w.id } });
  const stages = [];
  const tm = TM.createTurnModel({ streamFor: () => m, primaryId: 'p', backupId: 'b', onStage: (s) => stages.push(s) });
  tm.partial({ text: 'tell me how you do window cleaning', profile: DD });
  const r = await tm.forFinal({ text: 'tell me how you do window cleaning', profile: DD, budgetMs: 750 });
  assert.equal(m.seen.length, 1, 'one request');
  assert.equal(r.stage.requestsThisTurn, 1);
  assert.equal(r.stage.startedOn, 'partial');
  assert.equal(r.stage.reusedPartial, true);
  // stale: partial A, final B -> A cancelled, B is the one call used
  tm.partial({ text: 'how much is', profile: DD });
  const r2 = await tm.forFinal({ text: 'how much is window cleaning in Kisumu', profile: DD, budgetMs: 750 });
  assert.equal(r2.stage.cancelledStale, 1);
  assert.equal(r2.stage.startedOn, 'final');
  assert.equal(m.seen.length, 3);
  // same static prefix bytes turn to turn (implicit cache)
  assert.equal(JSON.stringify(m.seen[0].systemInstruction), JSON.stringify(m.seen[2].systemInstruction));
  assert.equal(JSON.stringify(m.seen[0].tools), JSON.stringify(m.seen[2].tools));
  // history is short and carries no prices/notes
  const body = JSON.stringify(m.seen[2]);
  assert.ok(!/KSh|shilling|\b40\b|\b200\b/i.test(body), 'no prices in the request');
});

test('M4 the traced stage is the call the reply used; M5 model text is never spoken', async () => {
  const w = svc(/window/i);
  const stages = [];
  const m = streamStandIn({ delayMs: 15, args: { asks: ['explain', 'price'], service_id: w.id } });
  const wrapped = async (a) => { const r = await m(a); return { ...r, text: 'MODEL SAYS HELLO' }; };
  const live = createBrainV2Live({ env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on' }, shadowModel: wrapped, applyTools: async () => ({ results: [] }), onModelStage: (s) => stages.push(s), traceTurnIndex: () => 0, log: () => {}, callSid: 'm4' });
  const out = await live.run({ text: 'and the windows thing, how is it done and what does it cost', profile: DD, langLock: 'en' });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].used, true);
  assert.equal(stages[0].callId, 'tm_1');
  assert.equal(m.seen.length, 1);
  const tr = live.getState().trace.find((t) => t.resolver);
  assert.equal(tr.resolver.fields, 'model');
  assert.ok(!/MODEL SAYS/.test(out.line), 'model text not spoken');
  TM.endCall('m4');
});

test('L1 harness: p90 caller-stop -> first audio vs v1 2408 ms', async () => {
  // model first-field latency drawn from v1 prod first-token quantiles (p50 1100 / p90 1383 / p99 2627 ms, n=362),
  // scaled 1:10 for test time. Half the turns get a partial head start of 600 ms (Voice's unfinished hold).
  // First audio = Brain line ready + TTS first-PCM delta from v1 (first PCM p90 2408 - first token p90 1383 = 1025 ms).
  const Q = [700, 850, 950, 1050, 1100, 1150, 1250, 1383, 1600, 2627];
  const SCALE = 10; const TTS_MS = 1025; const HEAD_MS = 600;
  const ms = [];
  for (let i = 0; i < 40; i += 1) {
    const lat = Q[i % Q.length]; const head = i % 2 ? HEAD_MS : 0;
    const m = streamStandIn({ delayMs: lat / SCALE, args: { asks: ['price'] } });
    const tm = TM.createTurnModel({ streamFor: () => m, primaryId: 'p', backupId: 'b', capMs: 1800 / SCALE, minAttemptMs: 25, sleep: (x) => sleep(x / SCALE) });
    if (head) { tm.partial({ text: 'how much is sofa cleaning', profile: DD }); await sleep(head / SCALE); }
    const t0 = Date.now();
    await tm.forFinal({ text: 'how much is sofa cleaning', profile: DD, budgetMs: 750 / SCALE });
    const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [] });
    const b0 = Date.now(); await V2.runTurn(st, { text: 'how much is sofa cleaning', profile: DD, now: NOW, handlers: H }); const brain = Date.now() - b0;
    ms.push((Date.now() - t0 - brain) * SCALE + brain + TTS_MS);
  }
  ms.sort((a, b) => a - b);
  const p90 = ms[Math.floor(0.9 * (ms.length - 1))];
  console.log(`# L1 p90 caller-stop->first-audio ${p90} ms (v1 2408 ms) p50 ${ms[Math.floor(ms.length / 2)]} ms`);
  assert.ok(p90 < 2408, `p90 ${p90}`);
});
