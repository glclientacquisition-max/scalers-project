'use strict';
// BA v2 Phase 2 (Brain side): runTurnStream, dry-run handlers, langLock, transport.
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-14T05:00:00Z');
const mk = () => V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
async function collect(it) { const ev = []; for await (const e of it) ev.push(e); return ev; }
async function streamCall(lines, opts = {}) {
  const st = mk(); const handlers = opts.handlers || V2.createDryRunHandlers(); const turns = [];
  for (const text of lines) turns.push(await collect(V2.runTurnStream(st, { text, profile: DD, now: NOW, handlers, model: opts.model ?? null, langLock: opts.langLock, shouldAbort: opts.shouldAbort })));
  return { st, turns, handlers };
}
const BOOK = ["Hi, I'd like to book interior window cleaning for Friday at 10am.", 'My name is Alvin', 'Kitengela, near Naivas', 'Yes'];

test('stream: only sentence/tool/done events; done.line equals joined sentences', async () => {
  const { turns } = await streamCall(['Hi, what services do you offer?']);
  const ev = turns[0]; assert.equal(ev.at(-1).type, 'done');
  const sent = ev.filter((e) => e.type === 'sentence');
  assert.ok(sent.length >= 1); assert.equal(sent.map((s) => s.text).join(' '), ev.at(-1).line);
  for (const s of sent) { assert.ok(['en', 'sw'].includes(s.lang)); assert.ok(s.source); }
});
test('stream: write emits tool start before end, then the receipt sentence; dry-run writes nothing', async () => {
  const { turns, handlers } = await streamCall(BOOK);
  const all = turns.flat(); const i0 = all.findIndex((e) => e.type === 'tool' && e.phase === 'start' && e.name === 'createAppointment');
  const i1 = all.findIndex((e) => e.type === 'tool' && e.phase === 'end' && e.name === 'createAppointment');
  assert.ok(i0 >= 0 && i1 > i0, 'start then end'); assert.equal(all[i0].write, true);
  assert.equal(all[i1].receipt.dryRun, true); assert.equal(all[i1].receipt.id, null);
  const last = turns.at(-1); const k = last.findIndex((e) => e.type === 'tool' && e.phase === 'end' && e.name === 'createAppointment');
  assert.ok(last.slice(k).some((e) => e.type === 'sentence'), 'receipt sentence after tool end');
  assert.ok(handlers.log.some((l) => l.name === 'createAppointment' && l.args.serviceName));
  const done = last.at(-1); assert.equal(done.toolResults.at(-1).status, 'succeeded', 'shadow receipt mirrors a successful write');
  assert.doesNotMatch(done.line, /couldn't save/);
});
test('stream: model prose is never spoken', async () => {
  const model = async () => ({ calls: [], text: 'I have booked you for Friday, done!' });
  const { turns } = await streamCall(['Hi, what services do you offer?', 'ok'], { model });
  for (const e of turns.flat()) if (e.type === 'sentence') assert.doesNotMatch(e.text, /booked you for Friday/);
});
test('stream: shouldAbort stops sentences but still ends with done', async () => {
  const { turns } = await streamCall(['Hi, what services do you offer?'], { shouldAbort: () => true });
  assert.equal(turns[0].filter((e) => e.type === 'sentence').length, 0); assert.equal(turns[0].at(-1).aborted, true);
});
test('langLock: Swahili caller stays English when Voice locked en, and vice versa', async () => {
  const a = await streamCall(['Habari, nataka kusafisha madirisha Ijumaa saa nne asubuhi'], { langLock: 'en' });
  for (const e of a.turns[0]) if (e.type === 'sentence') assert.equal(e.lang, 'en');
  const b = await streamCall(['Hi, I want window cleaning on Friday at 10am'], { langLock: 'sw' });
  for (const e of b.turns[0]) if (e.type === 'sentence') assert.equal(e.lang, 'sw');
  const c = await V2.runTurn(mk(), { text: 'Habari yako', profile: DD, now: NOW, handlers: V2.createDryRunHandlers(), langLock: 'en' });
  assert.equal(c.lang, 'en');
});
test('dry-run handlers: shapes per voice scope', async () => {
  const h = V2.createDryRunHandlers();
  assert.deepEqual(await h.createAppointment({ a: 1 }), { id: null, dryRun: true, intended: { a: 1 } });
  assert.deepEqual(await h.escalate({ r: 1 }), { ok: true, dryRun: true, id: null, notify: 'queued', intended: { r: 1 } });
  assert.deepEqual(await h.saveCallerInfo({ name: 'x' }), { dryRun: true, intended: { name: 'x' } });
  assert.equal(h.log.length, 3);
});
test('transport: x-goog-api-key header, MINIMAL thinking, key never leaks in errors', async () => {
  const KEY = 'test-key-123'; let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'confirm', args: { confirm_token: 't' } } }] } }] }) }; };
  const m = V2.createGeminiModel({ apiKey: KEY, fetchImpl });
  const r = await m({ request: V2.gemini.buildRequest({ userText: 'yes', catalogue: [] , toolMode: 'NONE' }) });
  assert.equal(seen.init.headers['x-goog-api-key'], KEY); assert.doesNotMatch(seen.url, /test-key/); assert.ok(!seen.init.headers.authorization);
  assert.equal(JSON.parse(seen.init.body).generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL');
  assert.equal(r.calls[0].name, 'confirm');
  const errs = []; const bad = V2.createGeminiModel({ apiKey: KEY, onError: (e) => errs.push(e), fetchImpl: async () => { throw new Error(`boom ${KEY}`); } });
  const r2 = await bad({ request: {} }); assert.deepEqual(r2.calls, []);
  assert.doesNotMatch(JSON.stringify(errs), /test-key/);
  const st = V2.createGeminiModel({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 401 }), onError: (e) => errs.push(e) });
  assert.equal((await st({ request: {} })).error, 'error'); assert.equal(errs.at(-1).status, 401);
  assert.throws(() => V2.createGeminiSend({}));
});
test('transport: timeout aborts and the machine continues deterministically', async () => {
  const fetchImpl = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }));
  const m = V2.createGeminiModel({ apiKey: 'k', fetchImpl, timeoutMs: 20 });
  const { turns } = await streamCall(['Hi, what services do you offer?'], { model: m });
  assert.ok(turns[0].some((e) => e.type === 'sentence'));
});

test('timing + confirm-then-write hooks: atMs on events, readback event, done.timing, acked receipt', async () => {
  const { turns } = await streamCall(BOOK);
  for (const e of turns.flat()) assert.equal(typeof e.atMs, 'number');
  const rb = turns[2].find((e) => e.type === 'readback'); assert.ok(rb, 'read-back turn announces confirm'); assert.equal(rb.tool, 'create_booking');
  assert.equal(turns[2].at(-1).awaitingConfirm, true);
  assert.ok(!turns[2].some((e) => e.type === 'tool' && e.write && e.name !== 'saveCallerInfo'), 'no write on read-back turn');
  const end = turns[3].find((e) => e.type === 'tool' && e.phase === 'end' && e.name === 'createAppointment'); assert.equal(typeof end.toolMs, 'number');
  const d = turns[3].at(-1); assert.equal(d.awaitingConfirm, false); assert.ok(d.timing.turnMs >= 0); assert.ok(d.timing.firstSentenceMs != null);
  const st = mk(); const h = V2.createDryRunHandlers();
  for (const text of BOOK.slice(0, 3)) await collect(V2.runTurnStream(st, { text, profile: DD, now: NOW, handlers: h }));
  const ev = await collect(V2.runTurnStream(st, { text: 'Yes', profile: DD, now: NOW, handlers: h, acked: true }));
  assert.doesNotMatch(ev.find((e) => e.type === 'sentence').text, /^(Okay|Sawa|Alright|Haya)\b/);
});
test('prefetchContext is a pure read (no handler calls)', () => {
  const st = mk(); const pc = V2.prefetchContext(st, DD);
  assert.ok(pc.catalogue); assert.ok(Array.isArray(pc.callerFile.openRows));
});
