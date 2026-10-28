// Run: node --test tests/callSummaryEventV2.test.js
// A4: `call.summary.ready` from BA v2 finishCall (machine state + commit receipts).
const test = require('node:test');
const assert = require('node:assert/strict');

// A4 receipts are built in finishCall only with CALL_SUMMARY_EVENT on.
process.env.CALL_SUMMARY_EVENT = 'on';
// These cases are Phase-1 (C1 off) unless a test turns commit safety on itself.
delete process.env.BRAIN_V2_COMMIT_SAFETY;
delete process.env.BRAIN_V2_OWNS_CALL;
const V2 = require('../src/conversation/v2');
const { finishCall } = require('../src/conversation/v2/machine');
const E = require('../src/conversation/callSummaryEvent');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const RS = JSON.parse(JSON.stringify(require('../evals/v2/fixtures/tenants/retail_shop.json')));
RS.productCatalog.push({ id: 'prd_protractor', name: 'Protractor', aliases: ['protractors'], price: '50', in_stock: null });
const NOW = new Date('2026-10-14T05:00:00Z');

function handlers({ failWrites = false } = {}) {
  const log = [];
  return { log, handlers: {
    createAppointment: async (a) => (log.push(['appt', a]), failWrites ? { id: null, ok: false } : { id: 'apt_1' }),
    updateAppointment: async (u) => (log.push(['upd', u]), { id: u.appointmentId }),
    createServiceRequest: async (r) => (log.push(['sr', r]), failWrites ? { id: null, ok: false } : { id: 'sr_1' }),
    escalate: async (e) => (log.push(['esc', e]), { ok: true }),
    saveCallerInfo: async () => ({ ok: true }),
  } };
}
async function call(profile, lines, { langLock = null, failWrites = false } = {}) {
  const h = handlers({ failWrites });
  const st = V2.createState({ profile, callerPhone: '+254700000001' });
  for (const text of lines) await V2.runTurn(st, { text, profile, now: NOW, handlers: h.handlers, langLock });
  const fin = finishCall(st, { businessName: profile.businessName, callerPhone: '+254700000001', profile });
  const built = E.buildCallSummaryEvent({
    path: 'v2', callLanguage: st.lang, callId: 'call_v2', tenantId: 'ten_v2', answered: true,
    infoAnswered: fin.infoAnswered, caller: { phone: '+254700000001', name: st.slots.name }, receipts: fin.summaryReceipts,
  });
  assert.equal(built.ok, true, built.errors.join('; '));
  return { e: built.event, fin, log: h.log, st };
}
const confirmed = (e) => e.receipts.filter((r) => r.status === 'confirmed');

test('v2 HD_8a8aa14db292 synthetic: stock ask + order interest, no write → 0 confirmed, stock unconfirmed', async () => {
  const { e, log } = await call(RS, ['Do you have protractors in stock?', 'I want to order a protractor.']);
  assert.equal(log.filter((x) => x[0] === 'sr').length, 0);
  assert.equal(confirmed(e).length, 0);
  assert.equal(e.outcome, 'info_only');
  const order = e.receipts.find((r) => r.type === 'order');
  assert.equal(order.status, 'unconfirmed');
  assert.equal(order.items[0].stock, 'unconfirmed');
  assert.equal(order.writtenRowId, undefined);
  assert.equal(e.path, 'v2');
});

test('v2 HD_e75a669780d4 synthetic: order with no quantity and no read-back → unconfirmed, qty not_given', async () => {
  const { e } = await call(RS, ['I want to order protractors.']);
  const [r] = e.receipts;
  assert.equal(r.type, 'order');
  assert.equal(r.status, 'unconfirmed');
  assert.deepEqual(r.items[0].qty, { status: 'not_given' });
  assert.equal(confirmed(e).length, 0);
});

test('v2 ordered EN: read-back + yes + row → confirmed with catalogue price and stock', async () => {
  const { e } = await call(RS, ["I'd like to order 2 diaries, pick up tomorrow. I am Brian.", 'Yes.']);
  assert.equal(e.outcome, 'ordered');
  const [r] = e.receipts;
  assert.equal(r.status, 'confirmed');
  assert.equal(r.writtenRowId, 'sr_1');
  assert.deepEqual(r.items[0].qty, { value: 2, status: 'given' });
  assert.deepEqual(r.items[0].unitPrice, { min: 350, max: 350, unit: 'each' });
  assert.equal(r.items[0].stock, 'in_stock');
  assert.deepEqual(r.slots.name, { value: 'Brian', status: 'given' });
});

test('v2 booked EN and SW', async () => {
  const en = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes.']);
  assert.equal(en.e.outcome, 'booked'); assert.equal(en.e.callLanguage, 'en');
  assert.equal(en.e.receipts[0].writtenRowId, 'apt_1');
  assert.equal(en.e.receipts[0].slots.place.value, 'Kitengela');
  const sw = await call(DD, ['Nataka kubook carpet cleaning kesho saa tatu asubuhi, Ruiru. Naitwa Wanjiru.', 'Ndio.']);
  assert.equal(sw.e.outcome, 'booked'); assert.equal(sw.e.callLanguage, 'sw');
  assert.equal(sw.e.receipts[0].status, 'confirmed');
});

test('v2 read-back never answered → unconfirmed booking, not booked', async () => {
  const { e } = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.']);
  assert.equal(e.outcome, 'info_only');
  assert.equal(e.receipts[0].status, 'unconfirmed');
  assert.equal(e.receipts[0].type, 'booking');
});

test('v2 failed write after yes → unconfirmed, never "booked"', async () => {
  const { e, fin } = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes.'], { failWrites: true });
  assert.equal(fin.outcome, 'write_failed', 'B2: commit safety is always on, so the old known gap (finishCall said booked) is closed');
  assert.equal(e.outcome, 'info_only');
  assert.equal(confirmed(e).length, 0);
});

test('v2 escalated EN and SW: caller asks for a person → escalation receipt, urgent', async () => {
  const en = await call(DD, ['I want to speak to the manager.', 'Yes.']);
  assert.equal(en.e.outcome, 'escalated'); assert.equal(en.e.urgent, true);
  assert.equal(en.e.escalationReason, 'Caller asked for a person');
  const sw = await call(DD, ['Nataka kuongea na manager.', 'Ndio.'], { langLock: 'sw' });
  assert.equal(sw.e.outcome, 'escalated'); assert.equal(sw.e.callLanguage, 'sw');
});

test('v2 callback_needed: a complaint is written for the owner to call back (not urgent)', async () => {
  const { e } = await call(DD, ['My sofa was damaged by your team.', 'They tore it.']);
  assert.equal(e.outcome, 'callback_needed');
  assert.equal(e.receipts[0].type, 'complaint');
  assert.equal(e.urgent, false);
});

test('v2 info_only and abandoned: hours answered vs bare hello', async () => {
  const info = await call(DD, ['What time do you open?']);
  assert.equal(info.e.outcome, 'info_only');
  const hello = await call(DD, ['Hello?']);
  assert.equal(hello.e.outcome, 'abandoned');
  assert.equal(hello.e.receipts.length, 0);
});

test('v2 finishCall keeps its legacy fields (ownerText, outcome)', async () => {
  const { fin } = await call(DD, ['What time do you open?']);
  assert.equal(typeof fin.ownerText, 'string');
  assert.equal(fin.outcome, 'answered');
});

test('v2 + v1 merge: same row once, v2 owns handoffs (no phantom urgent escalation)', () => {
  const v2 = [
    { receiptId: 'v2_1', type: 'order', status: 'confirmed', writtenRowId: 'sr_1', slots: {}, items: [] },
    { receiptId: 'v2_2', type: 'callback', status: 'confirmed', slots: {} },
  ];
  const v1 = [
    { receiptId: 'v1_1', type: 'order', status: 'unconfirmed', writtenRowId: 'sr_1', slots: {}, items: [] },
    { receiptId: 'v1_2', type: 'escalation', status: 'confirmed', slots: {} },
    { receiptId: 'v1_3', type: 'booking', status: 'unconfirmed', writtenRowId: 'apt_9', slots: {} },
  ];
  const merged = E.mergeV2Receipts(v2, v1);
  assert.deepEqual(merged.map((r) => [r.type, r.writtenRowId || null]), [['order', 'sr_1'], ['callback', null], ['booking', 'apt_9']]);
  const built = E.buildCallSummaryEvent({ path: 'v2', callLanguage: 'en', callId: 'c', tenantId: 't', answered: true, caller: { phone: '+254700000001' }, receipts: merged });
  assert.equal(built.ok, true, built.errors.join('; '));
  assert.equal(built.event.urgent, false);
  assert.equal(built.event.outcome, 'ordered');
});

test('v2 callback unconfirmed EN and SW (C1 off): the handoff read-back gives no time, so a yes is not enough', async () => {
  for (const langLock of [null, 'sw']) {
    const { e } = await call(DD, ['I want to pay to a different M-Pesa number, can you change my payment details?', langLock ? 'Ndio.' : 'Yes.'], { langLock });
    const [r] = e.receipts;
    assert.equal(r.type, 'callback');
    assert.equal(r.status, 'unconfirmed', String(langLock));
    assert.equal(e.outcome, 'callback_needed');
    assert.equal(e.urgent, false);
  }
});

test('v2 callback confirmed EN and SW: number + time read back, yes or the time repeated, write ok', () => {
  const { receiptsFromV2 } = require('../src/conversation/v2/summaryReceipts');
  const mk = (readbackLine, replyText, ok = true) => ({
    v: 2, slots: { name: null, items: [], when: {} }, staffNames: [], pending: null, intent: null,
    receipts: [{ tool: 'create_handoff', kind: 'ladder', ok, id: null, readbackLine, replyText }],
  });
  const cases = [
    ['The team will call you on this number tomorrow at 3 pm. Is that okay?', 'Yes.', true, 'confirmed'],
    ['Timu itakupigia kwa namba hii kesho saa tisa, ni sawa?', 'Kesho saa tisa.', true, 'confirmed'],
    ['The team will call you on this number tomorrow at 3 pm. Is that okay?', 'Okay wait.', true, 'unconfirmed'],
    ['Timu itakupigia kwa namba hii kesho saa tisa, ni sawa?', 'Ndio.', false, 'unconfirmed'],
  ];
  for (const [line, reply, ok, want] of cases) {
    const [r] = receiptsFromV2(mk(line, reply, ok), DD);
    assert.equal(r.type, 'callback');
    assert.equal(r.status, want, `${line} / ${reply} / ok=${ok}`);
    const built = E.buildCallSummaryEvent({ path: 'v2', callLanguage: 'en', callId: 'c', tenantId: 't', answered: true, caller: { phone: null }, receipts: [r] });
    assert.equal(built.ok, true, built.errors.join('; '));
    assert.equal(built.event.outcome, 'callback_needed');
    assert.equal(built.event.urgent, false);
  }
});

test('v2 order items carry the real catalogue id or null (never prd_<n> or name:<slug>)', async () => {
  const { e } = await call(RS, ["I'd like to order 2 diaries, pick up tomorrow. I am Brian.", 'Yes.']);
  assert.equal(e.receipts[0].items[0].catalogueId, null, 'fixture Diary row has no id');
  const p = await call(RS, ['I want to order protractors.']);
  assert.equal(p.e.receipts[0].items[0].catalogueId, 'prd_protractor');
});

// ---- C1 write receipts + C3 cached finish (branch of record #853) -----------

function withEnv(vars, fn) {
  return async () => {
    const prev = {};
    for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
    try { await fn(); } finally { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
  };
}
const CS_ON = { BRAIN_V2_COMMIT_SAFETY: 'on', BRAIN_V2_OWNS_CALL: null, CALL_SUMMARY_EVENT: 'on' };
function c1Handlers({ fail = false, callbackFail = false } = {}) {
  const receipts = [];
  return { receipts, h: {
    createAppointment: async () => (fail ? { id: null, ok: false } : { id: 'apt_9' }),
    updateAppointment: async (u) => ({ id: u.appointmentId }),
    createServiceRequest: async () => (fail ? null : { id: 'sr_9' }),
    escalate: async (e) => (/^write_failed/.test(e.reason) ? { ok: true, id: 'outbox_1' } : callbackFail ? { ok: false } : { ok: true, id: 'task_9' }),
    saveCallerInfo: async () => ({ ok: true }),
    recordWriteReceipt: async (r) => (receipts.push(r), { ok: true }),
  } };
}
async function c1Call(profile, lines, opts = {}) {
  const H = c1Handlers(opts);
  const st = V2.createState({ profile, callerPhone: '+254700000001', callId: 'HD_a4c1' });
  const out = [];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile, now: NOW, handlers: H.h, langLock: opts.langLock || null }));
  const fin = finishCall(st, { businessName: profile.businessName, callerPhone: '+254700000001', profile });
  const built = E.buildCallSummaryEvent({ path: 'v2', callLanguage: st.lang, callId: 'call_c1', tenantId: 'ten_c1', answered: true, infoAnswered: fin.infoAnswered, caller: { phone: '+254700000001' }, receipts: fin.summaryReceipts });
  assert.equal(built.ok, true, built.errors.join('; '));
  return { e: built.event, st, out, fin, phases: st.writeReceipts.map((w) => `${w.tool}:${w.phase}`) };
}

for (const [lang, ask, yes, echo] of [
  ['en', 'Can someone call me back?', 'Yes.', 'Today before 18:00.'],
  ['sw', 'Nipigie simu tafadhali', 'Ndio.', 'Leo kabla ya saa kumi na mbili jioni.'],
]) {
  test(`[${lang}] C1 callback confirmed: number + time read back, caller says yes, write ok`, withEnv(CS_ON, async () => {
    const r = await c1Call(DD, [ask, yes]);
    assert.match(r.out[0].line, lang === 'en' ? /call you back on 0700 000 001, today before 18:00\?$/ : /kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni\. Ni sawa\?$/);
    assert.deepEqual(r.phases, ['request_callback:proposed', 'request_callback:confirmed', 'request_callback:committed']);
    const [c] = r.e.receipts;
    assert.equal(c.type, 'callback');
    assert.equal(c.status, 'confirmed');
    assert.equal(r.e.outcome, 'callback_needed');
    assert.equal(r.e.urgent, false);
  }));

  test(`[${lang}] C1 callback confirmed: the caller repeating the exact read-back time is the yes (Alvin's rule, 15 Oct); write ok`, withEnv(CS_ON, async () => {
    // one shared read-back classifier (#849): a repeat of the exact read-back time confirms a callback as it does a booking
    const r = await c1Call(DD, [ask, echo]);
    assert.deepEqual(r.phases, ['request_callback:proposed', 'request_callback:confirmed', 'request_callback:committed']);
    const c = r.e.receipts.find((x) => x.type === 'callback');
    assert.equal(c.status, 'confirmed');
    assert.equal(r.e.outcome, 'callback_needed');
    // a different time is a change: re-proposed, nothing written or confirmed yet
    const other = await c1Call(DD, [ask, lang === 'en' ? 'At 3pm please.' : 'Saa tisa mchana.']);
    assert.deepEqual(other.phases, ['request_callback:proposed', 'request_callback:rejected', 'request_callback:proposed']);
    assert.equal(other.e.receipts.filter((x) => x.status === 'confirmed').length, 0);
    // the exact repeat failing to write is never confirmed
    const failed = await c1Call(DD, [ask, echo], { callbackFail: true });
    assert.ok(failed.phases.includes('request_callback:failed'));
    assert.equal(failed.e.receipts.find((x) => x.type === 'callback').status, 'unconfirmed');
  }));

  test(`[${lang}] C1 callback unconfirmed: 'okay wait' is not a yes (no write, nothing confirmed)`, withEnv(CS_ON, async () => {
    const r = await c1Call(DD, [ask, lang === 'en' ? 'Okay wait.' : 'Sawa ngoja kidogo.']);
    assert.equal(r.phases.includes('request_callback:committed'), false);
    assert.equal(r.e.receipts.filter((x) => x.status === 'confirmed').length, 0);
    const cb = r.e.receipts.find((x) => x.type === 'callback');
    if (cb) assert.equal(cb.status, 'unconfirmed');
  }));

  test(`[${lang}] C1 callback unconfirmed: the callback write failed`, withEnv(CS_ON, async () => {
    const r = await c1Call(DD, [ask, yes], { callbackFail: true });
    assert.ok(r.phases.includes('request_callback:failed'));
    const [c] = r.e.receipts;
    assert.equal(c.type, 'callback');
    assert.equal(c.status, 'unconfirmed');
  }));

  test(`[${lang}] C1 booking: proposed/confirmed/committed → confirmed with the row; failed write → never confirmed or booked`, withEnv(CS_ON, async () => {
    const book = lang === 'en' ? 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi Kitengela, naitwa Alvin.';
    const ok = await c1Call(DD, [book, yes]);
    assert.deepEqual(ok.phases, ['book_appointment:proposed', 'book_appointment:confirmed', 'book_appointment:committed']);
    assert.equal(ok.e.outcome, 'booked');
    assert.equal(ok.e.receipts[0].status, 'confirmed');
    assert.equal(ok.e.receipts[0].writtenRowId, 'apt_9');
    const bad = await c1Call(DD, [book, yes], { fail: true });
    assert.ok(bad.phases.includes('book_appointment:failed'));
    const b = bad.e.receipts.find((x) => x.type === 'booking');
    assert.equal(b.status, 'unconfirmed');
    assert.equal(b.writtenRowId, undefined);
    assert.notEqual(bad.e.outcome, 'booked');
  }));
}

test('C1 phases decide over the machine receipt: a failed phase or a missing confirmed phase is never confirmed', () => {
  const { receiptsFromV2 } = require('../src/conversation/v2/summaryReceipts');
  const base = (writeReceipts) => ({ v: 2, slots: { name: null, items: [], when: {} }, staffNames: [], pending: null, intent: null, writeReceipts,
    receipts: [{ tool: 'create_booking', ok: true, id: 'apt_1', idempotencyKey: 'k1', service: 'Sofa Cleaning', when: { date: '2026-10-16', time: '10:00' } }] });
  const at = (...ph) => ph.map((phase) => ({ idempotencyKey: 'k1', phase }));
  assert.equal(receiptsFromV2(base(at('proposed', 'confirmed', 'committed')), DD)[0].status, 'confirmed');
  assert.equal(receiptsFromV2(base(at('proposed', 'confirmed', 'failed')), DD)[0].status, 'unconfirmed');
  assert.equal(receiptsFromV2(base(at('proposed', 'committed')), DD)[0].status, 'unconfirmed');
  assert.equal(receiptsFromV2(base([]), DD)[0].status, 'confirmed', 'C1 off: no write receipts, the machine receipt decides');
  const dup = base(at('proposed', 'confirmed', 'committed'));
  dup.receipts.push({ ...dup.receipts[0], duplicate: true });
  assert.equal(receiptsFromV2(dup, DD).length, 1, 'an idempotent replay is not a second booking');
});

test('CALL_SUMMARY_EVENT off: finishCall result has no A4 fields (C3 summary patch unchanged)', withEnv({ CALL_SUMMARY_EVENT: null }, async () => {
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001' });
  await V2.runTurn(st, { text: 'What are your hours?', profile: DD, now: NOW, handlers: handlers().handlers });
  const fin = finishCall(st, { businessName: DD.businessName, callerPhone: '+254700000001', profile: DD });
  assert.equal('summaryReceipts' in fin, false);
  assert.equal('infoAnswered' in fin, false);
  const { summaryPatch } = require('../src/conversation/v2/ownsCall');
  assert.equal('summary_receipts' in summaryPatch(fin).brain_v2, false);
}));

test('C3 seam: A4 reads the cached once-only finish; finishCall runs once per call', withEnv({ ...CS_ON, BRAIN_V2_OWNS_CALL: 'on' }, async () => {
  const OC = require('../src/conversation/v2/ownsCall');
  const owned = OC.createOwnedCalls();
  const H = c1Handlers();
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', callId: 'HD_seam' });
  const live = owned.live('CA_seam', () => ({ getState: () => st }), { businessName: DD.businessName, callerPhone: '+254700000001', profile: DD });
  // B2: there is no ownsCallOn opt-out any more; a registered live call is always the v2 source
  assert.equal(OC.a4V2Source(owned, 'CA_seam', { ownsCallOn: false }).state, 'pending', 'the old opt-out arg is ignored');
  for (const text of ['Can someone call me back?', 'Yes.']) await V2.runTurn(live.getState(), { text, profile: DD, now: NOW, handlers: H.h });
  assert.equal(OC.a4V2Source(owned, 'CA_seam').state, 'pending', 'live, not finished yet: the summary waits');
  const first = owned.finish('CA_seam', owned.meta('CA_seam'));
  assert.equal(first.once, true);
  const src = OC.a4V2Source(owned, 'CA_seam');
  assert.equal(src.state, 'finished');
  assert.equal(src.fin.summaryReceipts[0].status, 'confirmed');
  assert.equal(owned.finish('CA_seam', owned.meta('CA_seam')).once, false);
  OC.a4V2Source(owned, 'CA_seam');
  assert.equal(owned.stats().finishRuns, 1, 'finishCall ran once');
  assert.ok(OC.summaryPatch(src.fin).brain_v2.summary_receipts.length);
  assert.equal(OC.a4V2Source(owned, 'CA_other').state, 'none');
}));

test('server.js A4 emitter never calls machine.finishCall itself (uses the C3 cached result)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  const body = src.slice(src.indexOf('async function emitHangupCallSummary'), src.indexOf('async function writeHangupSummary'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body, /finishCall\(|finishBrainV2Call|ownedV2Calls\.finish\(/);
  assert.match(body, /a4V2Source\(ownedV2Calls, callSid\)/);
  assert.match(body, /callerPhoneFrom\(call, brainState\)/);
});
