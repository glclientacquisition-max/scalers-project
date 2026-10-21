'use strict';
// BRAIN_V2_COMMIT_SAFETY (plan row C1): two-phase commit, validators, idempotency, write
// receipts (#845 shape), outbox on failure, callback read-back with number + when, and
// caller-name confirm (#844) only after a read-back yes. EN and SW. No network, no keys.
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const CS = require('../src/conversation/v2/commitSafety');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const RS = require('../evals/v2/fixtures/tenants/retail_shop.json');
const NOW = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT
const SUN_CLOSED = { ...DD, hoursSchedule: { ...DD.hoursSchedule, days: { ...DD.hoursSchedule.days, sun: { closed: true } } } };
const ROWS = [{ id: 'a', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', window_start: '2026-10-16T07:00:00Z' }];

function withFlag(fn, v = '1') {
  return async () => {
    const prev = process.env.BRAIN_V2_COMMIT_SAFETY;
    process.env.BRAIN_V2_COMMIT_SAFETY = v;
    try { await fn(); } finally { if (prev === undefined) delete process.env.BRAIN_V2_COMMIT_SAFETY; else process.env.BRAIN_V2_COMMIT_SAFETY = prev; }
  };
}
function handlers(opts = {}) {
  const log = []; const receipts = []; const names = [];
  return {
    log, receipts, names,
    h: {
      createAppointment: async (a) => { log.push(['appt', a]); await new Promise((r) => setImmediate(r)); return opts.fail ? { id: null, ok: false } : { id: `apt_${log.length}` }; },
      updateAppointment: async (u) => (log.push(['upd', u]), opts.fail ? { id: null, ok: false } : { id: u.appointmentId }),
      createServiceRequest: async (r) => (log.push(['sr', r]), opts.fail ? null : { id: 'sr_1' }),
      escalate: async (e) => { log.push(['esc', e]); if (opts.outboxFail && /^write_failed/.test(e.reason)) return { ok: false }; if (opts.fail && !/^write_failed/.test(e.reason)) return { ok: false }; return { ok: true, id: 'task_1' }; },
      saveCallerInfo: async (i) => (log.push(['name', i]), { ok: true }),
      recordWriteReceipt: async (r) => (receipts.push(r), { ok: true, id: `r${receipts.length}` }),
      confirmCallerName: async (n) => (names.push(n), { ok: true }),
    },
  };
}
async function talk(lines, opts = {}) {
  const H = handlers(opts);
  const profile = opts.profile || DD;
  const st = V2.createState({ profile, callerPhone: '+254700000001', openRows: opts.openRows || [], callId: 'HD_c1test' });
  const out = [];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile, now: opts.now || NOW, handlers: H.h }));
  return { st, out, ...H, writes: H.log.filter((x) => ['appt', 'upd', 'sr'].includes(x[0]) || (x[0] === 'esc' && !/^write_failed/.test(x[1].reason))) };
}
const phases = (rs) => rs.map((r) => r.phase);
const BOOK_EN = 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.';
const BOOK_SW = 'Nataka sofa cleaning Ijumaa saa nne asubuhi Kitengela, naitwa Alvin.';

test('flag is off by default; explicit whole-answer yes classifier', () => {
  assert.equal(CS.commitSafetyEnabled({}), false);
  assert.equal(CS.commitSafetyEnabled({ BRAIN_V2_COMMIT_SAFETY: '1' }), true);
  for (const y of ['Yes', 'Yes please', 'Yes, that is correct', 'yes book it', 'Ndio', 'Ndiyo, weka', 'Sawa', 'Okay.']) assert.equal(CS.explicitYes(y), true, y);
  for (const n of ['Okay wait', 'Okay wait, let me check with my wife', 'Yes but make it 11', 'Is it at 10?', 'Ndio, lakini Jumamosi', 'Sawa, ni hayo tu. Baadaye basi.', 'Sawa ngoja kidogo', 'Hmm', 'Yes, and also a carpet', 'Eeh...']) assert.equal(CS.explicitYes(n), false, n);
});

test('slot hash is stable over spelling/case and changes with any slot', () => {
  const p = { tool: 'create_booking', service: 'Sofa Cleaning (per seat)', when: { date: '2026-10-16', time: '10:00' }, place: 'Kitengela' };
  assert.equal(CS.slotHash(p), CS.slotHash({ ...p, service: 'sofa cleaning (PER SEAT)', place: 'kitengela' }));
  assert.notEqual(CS.slotHash(p), CS.slotHash({ ...p, when: { date: '2026-10-16', time: '11:00' } }));
  assert.equal(CS.idempotencyKey({ callId: 'HD_x', p }), `HD_x:create_booking:${CS.slotHash(p)}`);
});

for (const [lang, book, yes] of [['en', BOOK_EN, 'Yes'], ['sw', BOOK_SW, 'Ndio']]) {
  test(`[${lang}] booking: read-back, yes, one write; key on the row args and on every receipt`, withFlag(async () => {
    const r = await talk([book, yes]);
    assert.match(r.out[0].line, lang === 'en' ? /Sofa Cleaning on Friday 16 October at 10:00 in Kitengela, for Alvin\. Shall I book it\?/ : /Sofa Cleaning, Ijumaa 16 Oktoba saa nne asubuhi, Kitengela, kwa Alvin\. Nithibitishe\?/);
    assert.match(r.out[1].line, lang === 'en' ? /is booked/ : /nimeweka/);
    const appts = r.log.filter((x) => x[0] === 'appt');
    assert.equal(appts.length, 1);
    const key = appts[0][1].idempotencyKey;
    assert.match(key, /^HD_c1test:create_booking:[0-9a-f]{16}$/);
    assert.deepEqual(phases(r.receipts), ['proposed', 'confirmed', 'committed']);
    assert.ok(r.receipts.every((x) => x.idempotencyKey === key && x.tool === 'book_appointment' && x.path === 'v2'));
    assert.equal(r.receipts[0].confirmToken, r.receipts[1].confirmToken);
    assert.equal(r.receipts[1].tokenConfirmedTurn, r.receipts[0].tokenIssuedTurn + 1);
    assert.deepEqual(r.receipts[0].validators, { hours: 'ok', area: 'ok', availability: 'unchecked' });
    assert.equal(r.receipts[2].writeTable, 'appointments');
    assert.deepEqual(r.names.map((n) => [n.name, n.source]), [['Alvin', 'readback_yes']]);
  }));

  test(`[${lang}] "okay wait" / a question / "but" is not a yes; the read-back stays open`, withFlag(async () => {
    const wait = lang === 'en' ? 'Okay wait, let me check with my wife' : 'Sawa ngoja, niulize mke wangu kwanza';
    const r = await talk([book, wait]);
    assert.equal(r.writes.length, 0); assert.equal(r.names.length, 0);
    assert.match(r.out[1].line, lang === 'en' ? /take your time\. Shall I book it\?$/i : /chukua muda wako\. Nithibitishe\?$/i);
    const r2 = await talk([book, wait, yes]);
    assert.equal(r2.log.filter((x) => x[0] === 'appt').length, 1);
    const q = await talk([book, lang === 'en' ? 'Is it at 10?' : 'Je, ni saa nne?']);
    assert.equal(q.writes.length, 0);
    const b = await talk([book, lang === 'en' ? 'Yes but make it Saturday' : 'Ndio lakini iwe Jumamosi', yes]);
    assert.match(b.out[1].line, lang === 'en' ? /Saturday 17 October.*Shall I book it\?/ : /Jumamosi 17 Oktoba.*Nithibitishe\?/);
    const ap = b.log.filter((x) => x[0] === 'appt');
    assert.equal(ap.length, 1); assert.match(ap[0][1].windowStart, /^2026-10-17/);
  }));

  test(`[${lang}] a changed slot re-proposes (new hash, rejected receipt) and the write carries the new slot`, withFlag(async () => {
    const r = await talk([book, lang === 'en' ? 'Make it 11am' : 'Iwe saa tano asubuhi', yes]);
    assert.match(r.out[1].line, lang === 'en' ? /at 11:00 .*Shall I book it\?/ : /saa tano asubuhi.*Nithibitishe\?/);
    assert.deepEqual(phases(r.receipts), ['proposed', 'rejected', 'proposed', 'confirmed', 'committed']);
    assert.equal(r.receipts[1].errorCode, 'slot_diff');
    assert.notEqual(r.receipts[0].idempotencyKey, r.receipts[2].idempotencyKey);
    const ap = r.log.filter((x) => x[0] === 'appt');
    assert.equal(ap.length, 1); assert.match(ap[0][1].whenText, /11:00/);
    assert.equal(ap[0][1].idempotencyKey, r.receipts[2].idempotencyKey);
  }));

  test(`[${lang}] repeating the read-back time is a yes (Alvin's rule)`, withFlag(async () => {
    const r = await talk([book, lang === 'en' ? 'Uh, 10am' : 'Saa nne']);
    assert.equal(r.log.filter((x) => x[0] === 'appt').length, 1);
  }));

  test(`[${lang}] closed day: no proposal, honest hours line, never "booked"`, withFlag(async () => {
    const r = await talk([lang === 'en' ? 'Book sofa cleaning Sunday at 10am in Kitengela, I am Alvin.' : 'Nataka sofa cleaning Jumapili saa nne asubuhi Kitengela, naitwa Alvin.'], { profile: SUN_CLOSED });
    assert.match(r.out[0].line, lang === 'en' ? /closed on Sunday/ : /Jumapili tumefunga/);
    assert.doesNotMatch(r.out[0].line, /booked|nimeweka/i);
    assert.equal(r.receipts.length, 0); assert.equal(r.writes.length, 0);
  }));

  test(`[${lang}] out of area: no booking; callback offered with number + when`, withFlag(async () => {
    const r = lang === 'en' ? await talk(['Book sofa cleaning Friday at 10am in Mombasa, I am Alvin.', yes]) : await talk(['Nataka sofa cleaning Ijumaa saa nne asubuhi, naitwa Alvin.', 'Mombasa', yes]);
    if (lang === 'sw') { assert.equal(r.out[0].line, 'Tuje wapi?'); r.out.shift(); }
    const t0 = r.out[0].line;
    if (lang === 'en') { assert.match(t0, /^We don't cover Mombasa yet\. We serve .*Kitengela/); assert.match(t0, /call you back on 0700 000 001, today before 18:00, about Mombasa\?$/); } else { assert.match(t0, /^Bado hatufiki Mombasa\. Tunafika .*Kitengela/); assert.match(t0, /kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni, kuhusu Mombasa\. Ni sawa\?$/); }
    assert.equal(r.log.filter((x) => x[0] === 'appt').length, 0);
    const esc = r.log.filter((x) => x[0] === 'esc');
    assert.equal(esc.length, 1); assert.equal(esc[0][1].captured.callbackWhen, 'today before 18:00'); assert.equal(esc[0][1].captured.phone, '+254700000001');
    assert.deepEqual(r.receipts.map((x) => `${x.tool}:${x.phase}`), ['request_callback:proposed', 'request_callback:confirmed', 'request_callback:committed']);
    assert.equal(r.receipts[0].slots.when, 'today<18:00');
  }));

  test(`[${lang}] a write failing after yes: outbox owner task, honest line, not booked`, withFlag(async () => {
    const r = await talk([book, yes], { fail: true });
    assert.equal(r.out[1].line, lang === 'en' ? "Sorry, I couldn't save that. I've asked the owner to call you back." : 'Samahani, sikuweza kuhifadhi hilo. Nimemwomba mwenye biashara akupigie simu.');
    const ob = r.log.find((x) => x[0] === 'esc' && x[1].reason === 'write_failed:create_booking');
    assert.ok(ob); assert.equal(ob[1].kind, 'outbox'); assert.equal(ob[1].captured.idempotencyKey, r.receipts[0].idempotencyKey);
    assert.deepEqual(phases(r.receipts), ['proposed', 'confirmed', 'failed']);
    assert.equal(r.receipts[2].outboxTaskId, 'task_1'); // #845 keeps it only when it is a uuid
    const fin = V2.finishCall(r.st, { businessName: 'Done and Dusted', callerPhone: '+254700000001' });
    assert.equal(fin.outcome, 'write_failed');
    assert.doesNotMatch(fin.ownerText, /Visit booked/); assert.match(fin.ownerText, /could not save this request\. Nothing was booked/);
    assert.equal(r.out[1].toolResults[0].status, 'failed');
    const r2 = await talk([book, yes], { fail: true, outboxFail: true });
    assert.equal(r2.out[1].line, lang === 'en' ? "Sorry, I couldn't save that just now. Please call us again a little later." : 'Samahani, sikuweza kuhifadhi hilo sasa hivi. Tafadhali piga simu tena baadaye kidogo.');
  }));

  test(`[${lang}] order: read-back, quantity change re-proposes, yes writes once with the key`, withFlag(async () => {
    const first = lang === 'en' ? "Hi, I'd like to order 2 diaries, I'll pick them up tomorrow." : 'Habari, nataka kuagiza diary moja, nitaichukua kesho.';
    const r = await talk([first, 'Alvin', lang === 'en' ? 'Make it 3' : 'Iwe mbili', yes], { profile: RS });
    assert.match(r.out[1].line, lang === 'en' ? /^2 Diary, pickup .*Shall I place the order\?$/ : /^Diary 1, kuchukua .*Nithibitishe\?$/);
    assert.match(r.out[2].line, lang === 'en' ? /^3 Diary, pickup .*Shall I place the order\?$/ : /^Diary 2, kuchukua .*Nithibitishe\?$/);
    const sr = r.log.filter((x) => x[0] === 'sr');
    assert.equal(sr.length, 1); assert.match(sr[0][1].item, lang === 'en' ? /^3 x Diary/ : /^2 x Diary/);
    assert.equal(sr[0][1].idempotencyKey, r.receipts.at(-1).idempotencyKey);
    assert.deepEqual(r.receipts.map((x) => `${x.tool}:${x.phase}`), ['create_order:proposed', 'create_order:rejected', 'create_order:proposed', 'create_order:confirmed', 'create_order:committed']);
  }));

  test(`[${lang}] callback: read-back states the number AND when; yes saves one owner task`, withFlag(async () => {
    const r = await talk([lang === 'en' ? 'Can someone call me back?' : 'Nipigie simu tafadhali', yes]);
    assert.equal(r.out[0].line, lang === 'en' ? 'Shall I ask the owner to call you back on 0700 000 001, today before 18:00?' : 'Nimwombe mwenye biashara akupigie simu kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni. Ni sawa?');
    assert.match(r.out[1].line, lang === 'en' ? /The owner will call you back on 0700 000 001, today before 18:00\./ : /atakupigia simu kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni\./);
    assert.equal(r.writes.length, 1);
    // after hours the callback is the next open day
    const late = await talk([lang === 'en' ? 'Can someone call me back?' : 'Nipigie simu tafadhali'], { now: new Date('2026-10-14T17:00:00Z') });
    assert.match(late.out[0].line, lang === 'en' ? /tomorrow from 08:00\?$/ : /kesho kuanzia saa mbili asubuhi\. Ni sawa\?$/);
  }));

  test(`[${lang}] quote: offered, read back with number + when, yes saves a quote task`, withFlag(async () => {
    const r = await talk([lang === 'en' ? 'How much is gutter cleaning?' : 'Bei ya kusafisha gutter ni ngapi?', yes, yes]);
    assert.match(r.out[1].line, lang === 'en' ? /0700 000 001, today before 18:00, with a quote\?$/ : /0700 000 001, leo kabla ya saa kumi na mbili jioni, kukupa bei\. Ni sawa\?$/);
    assert.deepEqual(r.receipts.map((x) => `${x.tool}:${x.phase}`), ['quote:proposed', 'quote:confirmed', 'quote:committed']);
    assert.equal(r.writes.length, 1);
  }));

  test(`[${lang}] cancel and move: read-back + yes, keyed, one update each`, withFlag(async () => {
    const c = await talk([lang === 'en' ? 'I want to cancel my booking.' : 'Nataka kufuta booking yangu ya carpet.', yes], { openRows: ROWS });
    assert.deepEqual(c.log.filter((x) => x[0] === 'upd').map((x) => [x[1].appointmentId, x[1].status]), [['a', 'cancelled']]);
    assert.deepEqual(phases(c.receipts), ['proposed', 'confirmed', 'committed']);
    const m = await talk([lang === 'en' ? 'Can you move my carpet cleaning to Saturday at 11am?' : 'Songesha booking yangu ya carpet hadi Jumamosi saa tano asubuhi.', yes], { openRows: ROWS });
    const upd = m.log.filter((x) => x[0] === 'upd');
    assert.equal(upd.length, 1); assert.match(upd[0][1].windowStart, /^2026-10-17T08:00/);
  }));

  test(`[${lang}] double confirm makes a single row`, withFlag(async () => {
    const H = handlers();
    const st = V2.createState({ profile: DD, callerPhone: '+254700000001', callId: 'HD_dbl' });
    await V2.runTurn(st, { text: book, profile: DD, now: NOW, handlers: H.h });
    const [a, b] = await Promise.all([V2.runTurn(st, { text: yes, profile: DD, now: NOW, handlers: H.h }), V2.runTurn(st, { text: yes, profile: DD, now: NOW, handlers: H.h })]);
    assert.equal(H.log.filter((x) => x[0] === 'appt').length, 1, `${a.line} | ${b.line}`);
    // the same booking proposed and confirmed again in the call is not a second row
    const r = await talk([book, yes, book, yes]);
    assert.equal(r.log.filter((x) => x[0] === 'appt').length, 1);
    assert.match(r.out[3].line, lang === 'en' ? /already saved/ : /tayari limehifadhiwa/);
  }));
}

// Alvin's rule (15 Oct) for every read-back that states a time, callbacks included: the exact
// read-back time repeated = yes; a different time = change (re-propose); "okay wait" / a question = one re-ask.
for (const [lang, ask, echoWindow, other, otherRb, hold, question] of [
  ['en', 'Can someone call me back?', 'Today before 18:00.', 'At 3pm please.', /call you back on 0700 000 001, Wednesday 14 October at 15:00\?$/, 'Okay wait.', 'Before 18:00?'],
  ['sw', 'Nipigie simu tafadhali', 'Leo kabla ya saa kumi na mbili jioni.', 'Saa tisa mchana.', /kwa namba 0700 000 001, Jumatano 14 Oktoba saa tisa mchana\. Ni sawa\?$/, 'Sawa ngoja kidogo.', 'Kabla ya saa kumi na mbili jioni?'],
]) {
  test(`[${lang}] callback: repeating the exact read-back time confirms (one owner task)`, withFlag(async () => {
    const r = await talk([ask, echoWindow]);
    assert.match(r.out[1].line, lang === 'en' ? /^Okay\. The owner will call you back on 0700 000 001, today before 18:00\./ : /^Sawa\. Mwenye biashara atakupigia simu kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni\./);
    assert.equal(r.writes.length, 1);
    assert.deepEqual(r.receipts.map((x) => `${x.tool}:${x.phase}`), ['request_callback:proposed', 'request_callback:confirmed', 'request_callback:committed']);
    // an explicit callback time repeated exactly also confirms
    const t = await talk([ask, other, other]);
    assert.equal(t.writes.length, 1);
    assert.equal(t.log.find((x) => x[0] === 'esc')[1].captured.callbackWhen, 'Wednesday 14 October at 15:00');
  }));

  test(`[${lang}] callback: a different time re-proposes with that time; nothing is written`, withFlag(async () => {
    const r = await talk([ask, other]);
    assert.match(r.out[1].line, otherRb);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(r.receipts.map((x) => `${x.tool}:${x.phase}`), ['request_callback:proposed', 'request_callback:rejected', 'request_callback:proposed']);
    assert.equal(r.receipts[1].errorCode, 'slot_diff');
    assert.notEqual(r.receipts[2].confirmToken, r.receipts[0].confirmToken);
    // "at 18:00" is not "before 18:00": a new time, not a yes
    const at = await talk([ask, lang === 'en' ? '18:00' : 'Saa kumi na mbili jioni.']);
    assert.equal(at.writes.length, 0);
    assert.match(at.out[1].line, lang === 'en' ? /at 18:00\?$/ : /saa kumi na mbili jioni\. Ni sawa\?$/);
  }));

  test(`[${lang}] callback: 'okay wait' or the time as a question does not confirm; one re-ask`, withFlag(async () => {
    const w = await talk([ask, hold]);
    assert.equal(w.writes.length, 0);
    assert.ok(!w.receipts.some((x) => x.phase === 'confirmed'));
    assert.match(w.out[1].line, /\?$/);
    const q = await talk([ask, question]);
    assert.equal(q.writes.length, 0);
    assert.match(q.out[1].line, lang === 'en' ? /^Please say yes or no/ : /\?$/);
    // after the re-ask, a yes confirms
    const y = await talk([ask, hold, lang === 'en' ? 'Yes.' : 'Ndio.']);
    assert.equal(y.writes.length, 1);
  }));
}

test('one shared read-back classifier: bookings and callbacks follow the same rule', () => {
  const book = { tool: 'create_booking', when: { date: '2026-10-16', time: '10:00' } };
  const cb = { tool: 'create_handoff', kind: 'callback', callbackWhen: { key: 'today<18:00', at: { date: '2026-10-14', time: '18:00', rel: 'before' } } };
  const quote = { tool: 'create_handoff', kind: 'quote', callbackWhen: { key: '2026-10-15T09:00', at: { date: '2026-10-15', time: '09:00', rel: 'at' } } };
  const k = (p, text, when) => CS.readbackAnswer(p, { text, when }).kind;
  assert.equal(k(book, '10am', { time: '10:00' }), 'yes');
  assert.equal(k(book, '11am', { time: '11:00' }), 'change');
  assert.equal(k(book, 'is it at 10?', { time: '10:00' }), 'unclear');
  assert.equal(k(book, 'Friday', { date: '2026-10-16' }), 'unclear'); // a day alone is not a yes
  assert.equal(k(cb, 'before 6pm', { time: '18:00' }), 'yes');
  assert.equal(k(cb, 'kabla ya saa kumi na mbili', { time: '18:00' }), 'yes');
  assert.equal(k(cb, '6pm', { time: '18:00' }), 'change');
  assert.equal(k(cb, 'before 6pm?', { time: '18:00' }), 'unclear');
  assert.equal(k(cb, 'okay wait', null), 'unclear');
  assert.equal(k(quote, '9am', { time: '09:00' }), 'yes');
  assert.equal(k(quote, 'kesho saa tatu', { date: '2026-10-15', time: '09:00' }), 'yes');
  assert.equal(k(quote, '10am', { time: '10:00' }), 'change');
  assert.equal(k({ tool: 'create_handoff', callbackWhen: { key: 'working_hours', at: null } }, '3pm', { time: '15:00' }), 'change');
  assert.equal(k(cb, 'Yes', null), 'yes');
  assert.equal(k(cb, 'No', null), 'unclear'); // u.no is set by the NLU; text alone is not a no here
  assert.equal(CS.readbackAnswer(cb, { text: 'no', no: true }).kind, 'no');
});

test('a phone number is not a place; a place word at the name prompt keeps the place (edge E105/E128)', withFlag(async () => {
  const a = await talk(["I'd like to schedule sofa cleaning on Friday at 10am.", 'Also, my other number is 0712 345 678.']);
  assert.match(a.out[1].line, /^Where should we come\?/);
  const b = await talk(['Uh, book sofa cleaning Friday at 10am.', 'Kitengela', 'Ngong.', 'Njeri.']);
  assert.match(b.out[3].line, /in Kitengela, for Njeri\. Shall I book it\?$/);
  const c = await talk(['Book sofa cleaning Friday at 10am in Simba Drive, I am Alvin.']); // unknown word: confirmed by the read-back, not refused
  assert.match(c.out[0].line, /Simba Drive.*Shall I book it\?$/); assert.equal(c.receipts[0].validators.area, 'unknown');
}));

test('SW manager callback: the receipt names the same person as the read-back (parity)', withFlag(async () => {
  const a = await talk(['Naomba mwenye biashara anipigie.', 'Ndio'], { lang: 'sw' });
  assert.match(a.out[0].line, /Nimwombe meneja akupigie simu kwa namba 0700 000 001, leo kabla ya/);
  assert.match(a.out[1].line, /^Sawa\. Meneja atakupigia simu kwa namba 0700 000 001, leo kabla ya/);
}));

test('a yes that is not on the next turn after the read-back reads it back again', withFlag(async () => {
  const H = handlers();
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', callId: 'HD_stale' });
  await V2.runTurn(st, { text: BOOK_EN, profile: DD, now: NOW, handlers: H.h });
  st.pending.issuedTurn -= 1; // the read-back was two turns ago
  const r = await V2.runTurn(st, { text: 'Yes', profile: DD, now: NOW, handlers: H.h });
  assert.match(r.line, /Shall I book it\?$/); assert.equal(H.log.filter((x) => x[0] === 'appt').length, 0);
  const r2 = await V2.runTurn(st, { text: 'Yes', profile: DD, now: NOW, handlers: H.h });
  assert.match(r2.line, /is booked/); assert.equal(H.log.filter((x) => x[0] === 'appt').length, 1);
}));

test('an info question at the read-back is answered and the read-back is restated (fresh token)', withFlag(async () => {
  const r = await talk([BOOK_EN, 'How much is it?', 'Yes']);
  assert.match(r.out[1].line, /eight hundred shillings\. Sofa Cleaning on Friday .*Shall I book it\?$/);
  assert.equal(r.log.filter((x) => x[0] === 'appt').length, 1);
}));

test('decline and "no thanks, bye" at the read-back: rejected receipt, no write, no name confirm', withFlag(async () => {
  for (const no of ["No thanks, that's all. Bye.", 'Sawa, ni hayo tu. Baadaye basi.', 'Hapana']) {
    const r = await talk([BOOK_EN, no]);
    assert.equal(r.writes.length, 0, no); assert.equal(r.names.length, 0, no);
    assert.deepEqual(phases(r.receipts), ['proposed', 'rejected'], no);
  }
}));

test('flag off: Phase 1 behaviour unchanged (callback line, no receipts, no key)', withFlag(async () => {
  const r = await talk(['Can someone call me back?', 'Yes']);
  assert.equal(r.out[0].line, 'Shall I ask the team to call you back on this number?');
  assert.equal(r.receipts.length, 0);
  const b = await talk([BOOK_EN, 'Yes']);
  assert.equal(b.log.find((x) => x[0] === 'appt')[1].idempotencyKey, undefined);
}, ''));

test('live wiring: handlers pass tenant/call context to recordWriteReceipt and confirmCallerName', async () => {
  const { createLiveHandlers } = require('../src/conversation/v2/liveHandlers');
  const seen = [];
  const h = createLiveHandlers({ applyTools: async () => ({ results: [] }), ctx: { tenantId: 't1', callSid: 'HD_live', callerPhone: '+254700000001', recordWriteReceipt: async (r) => (seen.push(['r', r]), { ok: true }), confirmCallerName: async (n) => (seen.push(['n', n]), { ok: true }) } });
  await h.recordWriteReceipt({ path: 'v2', tool: 'book_appointment', phase: 'proposed', idempotencyKey: 'k' });
  await h.confirmCallerName({ name: 'Alvin' });
  assert.deepEqual(seen[0][1], { path: 'v2', tool: 'book_appointment', phase: 'proposed', idempotencyKey: 'k', tenantId: 't1', callId: 'HD_live', callSid: 'HD_live' });
  assert.deepEqual(seen[1][1], { tenantId: 't1', phone: '+254700000001', name: 'Alvin', source: 'readback_yes', callId: null });
  const bare = createLiveHandlers({ applyTools: async () => ({ results: [] }) });
  assert.equal((await bare.recordWriteReceipt({})).skipped, 'no_sink');
  assert.equal((await bare.confirmCallerName({ name: 'A' })).skipped, 'no_confirm_caller_name');
  const thrower = createLiveHandlers({ applyTools: async () => ({ results: [] }), ctx: { recordWriteReceipt: async () => { throw new Error('boom'); } } });
  assert.equal((await thrower.recordWriteReceipt({})).ok, false);
});

test('the idempotency key rides through tool validation to the row args', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'conversation', 'toolExecution.js'), 'utf8');
  assert.equal((src.match(/raw\.idempotencyKey \? \{ idempotencyKey: clean\(raw\.idempotencyKey, 200\) \}/g) || []).length, 2);
  const srv = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(srv, /appointment\.idempotencyKey \? \{ idempotencyKey: appointment\.idempotencyKey \}/);
  assert.match(srv, /request\.idempotencyKey \? \{ idempotencyKey: request\.idempotencyKey \}/);
  assert.match(srv, /recordWriteReceipt: typeof db\.recordWriteReceipt === 'function'/);
});
