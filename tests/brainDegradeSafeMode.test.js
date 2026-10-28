'use strict';
// B1 (retire the old brain): fail-closed degradation + safe mode, EN + SW, through runBrainEnginesTurn.
// No Gemini: keys unset, rules understanding or a stand-in model. Synthetic phone numbers only.
// Tenants are the prod gap shapes from the plan §2b (tests/helpers/b1Tenants.js):
//   Scalers BS, Uwezo   empty catalogue, no hours (real lines)
//   Done and Dusted     one item, no areas at all
//   Grow Tech, ALFAAL   areas only on an unconfirmed legacy list
//   Esga                area picks saved but never confirmed
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.BRAIN_SAFE_MODE;
const { TENANTS, tenant, NOW, svc } = require('./helpers/b1Tenants');
const { createState } = require('../src/conversation/v2/machine');
const { runBrainEnginesTurn } = require('../src/conversation/v2/brainEngines');
const D = require('../src/conversation/v2/degrade');
const BM = require('../src/conversation/v2/brainModeAdapter');
const Safe = require('../src/conversation/v2/safeMode');
const T = require('../src/conversation/v2/engineTools');
const { claimKind } = require('../src/conversation/v2/engineCommit');

const PHONE = '+254700000901'; // synthetic caller
const NUMS = /\d[\d,]*/g;

/** One call: turns of text (or [text, understanding] for a stand-in model). */
async function call(p, turns, { lang = null, env = {}, callerPhone = PHONE, rules = null, failWrite = false } = {}) {
  const m = createState({ profile: p, callerPhone, callId: `B1_${Math.random().toString(36).slice(2)}` });
  const writes = []; const alerts = []; const out = [];
  const handlers = {
    createServiceRequest: async (a) => { writes.push(a); return failWrite ? { ok: false, id: null, error: 'db_down' } : { ok: true, id: `sr_${writes.length}` }; },
    createAppointment: async (a) => { writes.push({ appointment: a }); return { ok: true, id: 'ap_1' }; },
  };
  for (const t of turns) {
    const [text, u] = Array.isArray(t) ? t : [t, null];
    const streamFor = u ? () => async ({ request }) => {
      if (/Read ONE caller turn/.test(JSON.stringify(request.systemInstruction || ''))) return { text: JSON.stringify({ intent: 'ask', answers: [], yes_no: null, slots: {}, language: lang || 'en', wants_human: false, closing: false, ...u }) };
      return { text: JSON.stringify({ reply: '' }) }; // the reply engine stands down: the receipt / fallback line is heard
    } : undefined;
    const r = await runBrainEnginesTurn({ text, profile: p, machine: m, env, langLock: lang, handlers, streamFor, modelId: u ? 'stub' : undefined,
      opts: { now: NOW, dispatch: async (x) => { alerts.push(x); return { channel: 'sms' }; }, ...(rules ? { degradeRules: rules } : {}) } });
    out.push({ ...r, trace: m.trace[m.trace.length - 1].brain_engines });
  }
  return { out, writes, alerts, m, last: out[out.length - 1] };
}
const noInventedNumbers = (line, allowed = []) => { for (const n of String(line).replace(/0\d{3} \d{3} \d{3}/g, '').match(NUMS) || []) assert.ok(allowed.includes(n.replace(/,/g, '')), `invented number ${n} in: ${line}`); };
const NO_FIRM_AREA = /\b(yes,? we (cover|come)|we cover|sorry,? we don'?t (cover|come)|ndio,? tunafika|hatufiki)\b/i;
const NO_PLAIN_NO = /\b(we don'?t (offer|sell|do|have)|hatuna|hatufanyi|hatuuzi)\b/i;

describe('B1 named rules: one table, each flippable', () => {
  it('every default is on (Alvin approved all of them, 28 Oct) and rulesFor flips one without touching the others', () => {
    assert.deepEqual(D.RULE_NAMES, ['SPARSE_UNKNOWN_ITEM', 'EMPTY_CATALOGUE_CAPTURE', 'NO_HOURS_BOOKING_AS_REQUEST', 'UNCONFIRMED_AREAS_NO_VERDICT', 'NO_POLICY_TEAM_CONFIRM']);
    for (const k of D.RULE_NAMES) assert.equal(D.RULES[k].on, true, k);
    const r = D.rulesFor({ SPARSE_UNKNOWN_ITEM: false, EMPTY_CATALOGUE_CAPTURE: { on: true } });
    assert.equal(r.SPARSE_UNKNOWN_ITEM.on, false);
    assert.equal(r.SPARSE_UNKNOWN_ITEM.minItems, 5);
    assert.equal(r.NO_HOURS_BOOKING_AS_REQUEST.on, true);
    assert.ok(Object.isFrozen(D.RULES));
  });
  it('catalogue state: empty / sparse until >= 5 offered AND owner-marked complete', () => {
    assert.equal(D.catalogueState(TENANTS.scalersBs()), 'empty');
    assert.equal(D.catalogueState(TENANTS.dnd()), 'sparse');
    const many = tenant({ id: 'many', name: 'Many', items: [1, 2, 3, 4, 5, 6].map((i) => svc({ id: `s${i}`, name_en: `Service ${i}` })) });
    assert.equal(D.catalogueState(many), 'sparse', 'no owner "complete" mark yet');
    many.kbCatalogueComplete = true;
    assert.equal(D.catalogueState(many), 'complete');
    assert.equal(D.catalogueState({ id: 'legacy' }), null, 'not on the KB: untouched');
  });
  it('every degraded receipt / line is honest: no unbacked "the team will" claim (commit truth keeps it)', () => {
    for (const lang of ['en', 'sw']) {
      for (const t of [D.teamConfirmText(null, lang), D.teamConfirmText('pianos', lang), D.hours({ receipt: null, profile: TENANTS.scalersBs(), lang }).receipt.text, D.policy({ topic: 'payment', lang, profile: {} }).receipt.text, Safe.safeReceipt({ answers: ['price'] }, 'how much?', lang).text]) {
        for (const s of t.split(/(?<=[.?!])\s+/)) assert.equal(claimKind(s), null, `${lang}: ${s}`);
      }
    }
  });
});

describe('B1 EMPTY_CATALOGUE_CAPTURE: Scalers BS and Uwezo (empty snapshot, no hours)', () => {
  for (const [key, lang, turns] of [
    ['scalersBs', 'en', ['what do you offer?', 'My name is Wanjiru', 'yes']],
    ['uwezo', 'en', ['how much do you charge?', 'My name is Wanjiru', 'yes']],
    ['scalersBs', 'sw', ['Mnauza nini?', 'Naitwa Akinyi', 'ndio']],
    ['uwezo', 'sw', ['Bei ni ngapi?', 'Naitwa Akinyi', 'ndio']],
  ]) {
    it(`${key} ${lang}: no list, no price, no "we don't offer"; name -> read-back -> yes -> saved -> alert`, async () => {
      const { out, writes, alerts } = await call(TENANTS[key](), turns, { lang: lang === 'sw' ? 'sw' : null });
      const [a, b, c] = out;
      assert.equal(a.goal.type, 'ask'); assert.equal(a.goal.slot, 'name');
      assert.match(a.line, lang === 'sw' ? /athibitishe/ : /have the team confirm/);
      assert.doesNotMatch(a.line, NO_PLAIN_NO);
      noInventedNumbers(a.line);
      assert.equal(a.trace.brain_stage, 'degraded');
      assert.deepEqual(a.trace.degraded, ['EMPTY_CATALOGUE_CAPTURE']);
      assert.equal(b.goal.type, 'readback');
      assert.match(b.line, /0700 000 901/);
      assert.equal(b.write, null, 'nothing saved before the yes');
      assert.equal(c.goal.type, 'commit');
      assert.equal(c.write.status, 'committed');
      assert.equal(writes.length, 1);
      assert.match(writes[0].notes, /EMPTY_CATALOGUE_CAPTURE/);
      assert.match(writes[0].notes, lang === 'sw' ? /mnauza nini|bei ni ngapi/i : /what do you offer|how much do you charge/i, 'the ask is the reason');
      assert.equal(alerts.length, 1, 'owner alert after the save');
    });
  }
  it('a catalogue ask with no model and an empty snapshot is never the open "How can I help?"', async () => {
    for (const t of ['do you sell solar panels?', 'what services do you have']) {
      const { last } = await call(TENANTS.scalersBs(), [t]);
      assert.ok(!/how can i help/i.test(last.line), last.line);
      assert.match(last.line, /team confirm/);
    }
  });
  it('rule off: the empty snapshot falls back to the pre-B1 path (no capture opened)', async () => {
    const { last } = await call(TENANTS.scalersBs(), ['what do you offer?'], { rules: { EMPTY_CATALOGUE_CAPTURE: false } });
    assert.notEqual(last.goal.type === 'ask' && last.goal.degraded, 'EMPTY_CATALOGUE_CAPTURE');
    assert.deepEqual(last.trace.degraded, []);
  });
});

describe('B1 NO_HOURS_BOOKING_AS_REQUEST: Scalers BS and Uwezo (no hours)', () => {
  for (const lang of ['en', 'sw']) {
    it(`${lang}: "when are you open" states no time and offers the callback`, async () => {
      const { last } = await call(TENANTS.uwezo(), [lang === 'sw' ? 'Mnafungua saa ngapi?' : 'when are you open?'], { lang: lang === 'sw' ? 'sw' : null });
      assert.equal(last.goal.type, 'answer');
      assert.ok(last.goal.teamConfirm);
      assert.match(last.line, lang === 'sw' ? /saa zetu za kazi.*akupigie\?/ : /confirm our hours.*call you back\?/);
      assert.doesNotMatch(last.line, /\d{1,2}(:\d{2})?\s*(am|pm)|\d{2}:\d{2}/i);
      assert.deepEqual(last.trace.degraded, ['NO_HOURS_BOOKING_AS_REQUEST']);
    });
    it(`${lang}: a booking becomes a request with the preferred time; no slot is offered as available`, async () => {
      const p = TENANTS.scalersBs();
      const turns = lang === 'sw'
        ? [['Nataka kubook mkutano kesho saa nne', { intent: 'book', slots: { day: '2026-10-29', time: '10:00' }, language: 'sw' }], 'Naitwa Akinyi', 'ndio']
        : [['I want to book a consultation tomorrow at 10', { intent: 'book', slots: { day: '2026-10-29', time: '10:00' } }], 'My name is Wanjiru', 'yes'];
      const { out, writes } = await call(p, turns, { lang: lang === 'sw' ? 'sw' : null });
      assert.equal(out[0].goal.type, 'ask'); assert.equal(out[0].goal.slot, 'name'); assert.equal(out[0].goal.why, 'callback');
      assert.equal(out[1].goal.type, 'readback');
      assert.match(out[1].line, lang === 'sw' ? /athibitishe muda.*Ni sawa\?/ : /confirm a time.*call you back on 0700 000 901\?/);
      assert.doesNotMatch(out[1].line, /shall I book|nithibitishe\?/i);
      assert.equal(out[2].write.status, 'committed');
      assert.equal(writes.length, 1);
      assert.ok(!writes[0].appointment, 'never an appointment row');
      assert.match(writes[0].notes, /Booking request; preferred 2026-10-29 10:00; please confirm the time/);
      assert.match(out[2].line, lang === 'sw' ? /^Tayari/ : /^Done, I've asked the owner/);
      assert.ok(!/booked|nimekuwekea/i.test(out[2].line), out[2].line);
    });
  }
  it('a business WITH hours still books as before (D&D)', async () => {
    const { out } = await call(TENANTS.dnd(), [['book a deep clean tomorrow at 10 in Kilimani', { intent: 'book', slots: { service: 'Deep clean', day: '2026-10-29', time: '10:00', place: 'Kilimani' } }]]);
    assert.notEqual(out[0].goal.why, 'callback');
    assert.ok(!(out[0].goal.p && out[0].goal.p.request === 'booking'));
  });
});

describe('B1 SPARSE_UNKNOWN_ITEM: Done and Dusted (1 item)', () => {
  for (const [lang, text, item] of [['en', 'do you do pest control?', 'pest control'], ['sw', 'Mnafanya fumigation?', 'fumigation']]) {
    it(`${lang}: an item the catalogue does not carry gets "the team will confirm" + capture, never "we don't offer"`, async () => {
      const { out, writes } = await call(TENANTS.dnd(), [[text, { answers: ['services'], slots: { service: item }, language: lang }], lang === 'sw' ? 'Naitwa Akinyi' : 'My name is Otieno', lang === 'sw' ? 'ndio' : 'yes'], { lang: lang === 'sw' ? 'sw' : null });
      assert.equal(out[0].goal.type, 'ask'); assert.equal(out[0].goal.slot, 'name');
      assert.match(out[0].line, new RegExp(item));
      assert.doesNotMatch(out[0].line, NO_PLAIN_NO);
      assert.deepEqual(out[0].trace.degraded, ['SPARSE_UNKNOWN_ITEM']);
      assert.match(out[1].line, new RegExp(item, 'i'), 'the read-back names the ask');
      assert.equal(out[2].write.status, 'committed');
      assert.match(writes[0].notes, new RegExp(`Caller asked about: ${item}`));
    });
  }
  it('the one item still answers with its own price (no degradation)', async () => {
    const { last } = await call(TENANTS.dnd(), ['how much is a deep clean?']);
    assert.match(last.line, /6,000/);
    assert.deepEqual(last.trace.degraded, []);
    assert.equal(last.trace.brain_stage, 'full');
  });
  it("#1004's not_in_catalogue receipt is rewritten on a sparse catalogue, kept on a complete one", () => {
    const miss = { tool: 'catalogue', ok: true, kb: true, kind: 'not_in_catalogue', asked: 'pianos', text: "Sorry, we don't offer pianos." };
    const p = TENANTS.dnd();
    const d = D.catalogue({ receipt: miss, u: {}, text: 'do you sell pianos', profile: p, lang: 'en' });
    assert.equal(d.fired, 'SPARSE_UNKNOWN_ITEM'); assert.equal(d.receipt.kind, 'team_confirm'); assert.match(d.receipt.text, /team confirm pianos/);
    const sw = D.catalogue({ receipt: miss, u: {}, text: 'mnauza piano', profile: p, lang: 'sw' });
    assert.match(sw.receipt.text, /athibitishe kuhusu pianos/);
    const many = tenant({ id: 'full', name: 'Full', items: [1, 2, 3, 4, 5].map((i) => svc({ id: `s${i}`, name_en: `Service ${i}` })) });
    many.kbCatalogueComplete = true;
    assert.equal(D.catalogue({ receipt: miss, u: {}, text: 'x', profile: many, lang: 'en' }).receipt, miss);
    assert.equal(D.catalogue({ receipt: miss, u: {}, text: 'x', profile: p, lang: 'en', rules: D.rulesFor({ SPARSE_UNKNOWN_ITEM: false }) }).receipt, miss);
  });
});

describe('B1 UNCONFIRMED_AREAS_NO_VERDICT: never a firm yes / no without confirmed picks', () => {
  const cases = [
    ['dnd', 'en', 'do you come to Westlands?', 'Westlands', true],
    ['dnd', 'sw', 'Mnafika Westlands?', 'Westlands', true],
    ['growTech', 'en', 'do you come to Westlands?', 'Westlands', true], // legacy list said yes
    ['growTech', 'sw', 'Mnafika Kericho?', 'Kericho', true], // legacy tree said "outside"
    ['alfaal', 'en', 'do you come to Nyali?', 'Nyali', true],
    ['alfaal', 'sw', 'Mnafika Nairobi?', 'Nairobi', true],
    ['esga', 'en', 'do you come to Westlands?', 'Westlands', false], // unconfirmed picks: already "check with the owner"
    ['esga', 'sw', 'Mnafika Kisumu?', 'Kisumu', false],
  ];
  for (const [key, lang, text, place, fires] of cases) {
    it(`${key} ${lang}: "${text}" -> check with the owner about ${place}, no fee`, async () => {
      const { last } = await call(TENANTS[key](), [text], { lang: lang === 'sw' ? 'sw' : null });
      assert.doesNotMatch(last.line, NO_FIRM_AREA);
      assert.match(last.line, lang === 'sw' ? new RegExp(`Nitaangalia na mmiliki kuhusu ${place}`) : new RegExp(`check with the owner about ${place}`));
      noInventedNumbers(last.line);
      assert.deepEqual(last.trace.degraded, fires ? ['UNCONFIRMED_AREAS_NO_VERDICT'] : []);
    });
  }
  it('confirmed picks keep their firm answer (rule does not touch them)', () => {
    const r = { place: 'Kileleshwa', covered: 'yes', status: 'covered', source: 'area_picks', line_en: 'Yes, we cover Kileleshwa.' };
    assert.equal(D.areaRow(r).row, r);
    assert.equal(D.areaRow(r).fired, null);
  });
  it('a booking into an "outside" legacy place is no longer routed as area_outside', () => {
    const { shouldHandoff } = require('../src/conversation/v2/handoff');
    const p = TENANTS.growTech();
    const m = createState({ profile: p, callerPhone: PHONE });
    assert.equal(shouldHandoff({ understanding: { intent: 'book', slots: { place: 'Kericho' } }, machine: m, profile: p, now: NOW }), null);
  });
});

describe('B1 NO_POLICY_TEAM_CONFIRM', () => {
  for (const lang of ['en', 'sw']) {
    it(`${lang}: payment with no policy on file -> the team confirms, no invented till / paybill number`, async () => {
      const { last } = await call(TENANTS.dnd(), [[lang === 'sw' ? 'Mnalipwa aje?' : 'how do I pay?', { answers: ['payment'], language: lang }]], { lang: lang === 'sw' ? 'sw' : null });
      assert.match(last.line, lang === 'sw' ? /malipo/ : /payment details/);
      noInventedNumbers(last.line);
      assert.deepEqual(last.trace.degraded, ['NO_POLICY_TEAM_CONFIRM']);
    });
  }
});

describe('B1 safe mode: brainMode(tenant, { safeEnv }) -> { mode, reason }', () => {
  it('default full; owner / admin / env reasons; never throws', () => {
    assert.deepEqual(BM.brainMode({ id: 't' }, {}), { mode: 'full', reason: 'default' });
    assert.deepEqual(BM.brainMode({ brain_mode: 'full' }, { safeEnv: 'off' }), { mode: 'full', reason: 'default' });
    assert.deepEqual(BM.brainMode({ brain_mode: 'safe', brain_mode_source: 'owner' }, {}), { mode: 'safe', reason: 'owner' });
    assert.deepEqual(BM.brainMode({ brainMode: 'safe', brainModeSource: 'admin' }, {}), { mode: 'safe', reason: 'admin' });
    assert.deepEqual(BM.brainMode({ brain_mode: 'safe' }, {}), { mode: 'safe', reason: 'admin' }, 'unknown setter reads admin');
    assert.deepEqual(BM.brainMode({ brain_mode: 'full' }, { safeEnv: 'all' }), { mode: 'safe', reason: 'env' });
    assert.deepEqual(BM.brainMode({ brain_mode: 'full' }, { safeEnv: 'ALL ' }), { mode: 'safe', reason: 'env' });
    assert.deepEqual(BM.brainMode(null, {}), { mode: 'full', reason: 'no_tenant' });
    assert.equal(BM.brainMode({ get brain_mode() { throw new Error('x'); } }, {}).mode, 'full');
  });
  it('never automatic: an empty catalogue with no hours (Scalers BS) is still full mode', async () => {
    const { last } = await call(TENANTS.scalersBs(), ['hello']);
    assert.equal(last.brainMode, 'full');
    assert.equal(last.trace.brain_mode, 'full');
  });
  it('decided once per call and pinned (an env flip mid-call does not change the call)', async () => {
    const p = TENANTS.dnd();
    const m = createState({ profile: p, callerPhone: PHONE });
    assert.equal(BM.callMode(m, p, {}).mode, 'full');
    assert.equal(BM.callMode(m, p, { BRAIN_SAFE_MODE: 'all' }).mode, 'full');
  });
  it('tenants.brain_mode reaches the profile (tenantProfileFromRow)', () => {
    const p = tenant({ id: 'sm', name: 'SM', brainMode: 'safe', brainModeSource: 'owner' });
    assert.equal(p.brainMode, 'safe'); assert.equal(p.brainModeSource, 'owner');
    assert.equal(TENANTS.dnd().brainMode, null);
  });
});

describe('B1 safe mode: the capture-only call (EN + SW)', () => {
  const safeDnd = (source = 'owner') => tenant({ id: 'dnd-safe', name: 'Done and Dusted', brainMode: 'safe', brainModeSource: source, items: [svc({ id: 'dc', name_en: 'Deep clean', price_amount: 6000 })] });
  it('en (owner "Take messages only"): price question -> no price; name -> read-back of all three -> yes -> saved -> alert -> close', async () => {
    const { out, writes, alerts } = await call(safeDnd('owner'), ['Hi, how much is a deep clean?', 'My name is Wanjiru', 'yes', 'no thanks']);
    assert.equal(out[0].goal.type, 'ask'); assert.equal(out[0].goal.slot, 'name');
    assert.doesNotMatch(out[0].line, /6,000|6000|deep clean is/i);
    assert.match(out[0].line, /team can follow up/);
    assert.equal(out[1].goal.type, 'readback');
    assert.equal(out[1].line, 'Wanjiru, shall I ask the team to call you back on 0700 000 901 about how much is a deep clean?');
    assert.equal(out[1].write, null);
    assert.equal(out[2].write.status, 'committed');
    assert.equal(writes[0].notes, 'Safe mode callback: how much is a deep clean.');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].body, /how much is a deep clean/);
    assert.equal(out[3].goal.type, 'close');
    for (const r of out) {
      assert.equal(r.trace.brain_stage, 'safe'); assert.equal(r.trace.brain_mode, 'safe'); assert.equal(r.trace.brain_mode_reason, 'owner');
      assert.equal(r.path === 'brain_engines_safe' || r.path === 'brain_engines_commit', true, r.path);
    }
  });
  it('sw, caller ID withheld (admin): name -> number asked -> reason -> read-back -> ndio -> saved', async () => {
    const { out, writes } = await call(safeDnd('admin'), ['Habari', 'Naitwa Akinyi', '0711 222 333', 'Nataka kuuliza kuhusu bei ya usafi', 'ndio'], { lang: 'sw', callerPhone: null });
    assert.deepEqual(out.slice(0, 3).map((r) => r.goal.slot), ['name', 'phone', 'reason']);
    assert.equal(out[3].goal.type, 'readback');
    assert.equal(out[3].line, 'Akinyi, nimwombe mwenye biashara akupigie kwa namba 0711 222 333 kuhusu bei ya usafi. Ni sawa?');
    assert.equal(out[4].write.status, 'committed');
    assert.equal(writes[0].phone, '+254711222333');
    assert.equal(out[0].trace.brain_mode_reason, 'admin');
  });
  it('env brake (BRAIN_SAFE_MODE=all): booking, hours and area asks get no slot, time or verdict', async () => {
    const { out, writes } = await call(TENANTS.dnd(), [
      ['I want to book a deep clean tomorrow at 10 in Westlands', { intent: 'book', slots: { service: 'Deep clean', day: '2026-10-29', time: '10:00', place: 'Westlands' } }],
      'when are you open?', 'My name is Wanjiru', 'yes'], { env: { BRAIN_SAFE_MODE: 'all' } });
    for (const r of out) { assert.doesNotMatch(r.line, /booked|shall i book|\b\d{1,2}:\d{2}\b|we cover|6,000/i, r.line); assert.equal(r.trace.brain_mode_reason, 'env'); }
    assert.equal(out[2].goal.type, 'readback');
    assert.match(out[2].line, /about book a deep clean tomorrow/);
    assert.equal(out[3].write.status, 'committed');
    assert.ok(!writes.some((w) => w.appointment), 'never an appointment in safe mode');
  });
  it('one correction loop: no -> what to change -> new number -> read back again -> yes', async () => {
    const { out, writes } = await call(safeDnd(), ['I need someone to call me about an invoice', 'My name is Wanjiru', 'no', 'call me on 0722 333 444 instead', 'yes']);
    assert.equal(out[2].goal.type, 'ask'); assert.equal(out[2].goal.slot, 'change');
    assert.equal(out[3].goal.type, 'readback'); assert.match(out[3].line, /0722 333 444/);
    assert.equal(out[4].write.status, 'committed');
    assert.equal(writes[0].phone, '+254722333444');
  });
  it('a second no closes politely with nothing saved', async () => {
    const { out, writes } = await call(safeDnd(), ['call me about an invoice please', 'My name is Wanjiru', 'no', 'no', 'no']);
    assert.equal(out[out.length - 1].goal.type, 'close');
    assert.equal(writes.length, 0);
  });
  it('commit gate: a failed save is never confirmed (honest line; the owner note row is the fallback)', async () => {
    const { out, writes } = await call(safeDnd(), ['call me about an invoice please', 'My name is Wanjiru', 'yes'], { failWrite: true });
    assert.notEqual(out[2].write.status, 'committed');
    assert.doesNotMatch(out[2].line, /^Done|I've asked the owner/);
    assert.match(out[2].line, /Sorry/);
    assert.ok(writes.length >= 1);
  });
  it('safe mode carries no catalogue, price, area or hours receipt (tools stand down)', async () => {
    const { m } = await call(safeDnd(), [['how much is a deep clean, and do you come to Westlands?', { answers: ['price', 'coverage'], slots: { service: 'Deep clean', place: 'Westlands' } }]]);
    const r = Safe.safeReceipt({ answers: ['price', 'coverage'] }, 'x?', 'en');
    assert.equal(r.tool, 'safe_mode');
    assert.ok(!(m.kb && m.kb.last), 'the KB was never read');
  });
  it('full mode (default) is unchanged by the adapter: same D&D price answer as before B1', async () => {
    const { last } = await call(TENANTS.dnd(), ['how much is a deep clean?']);
    assert.equal(last.brainMode, 'full'); assert.equal(last.trace.brain_mode_reason, 'default');
    assert.equal(last.line, 'Deep clean is 6,000 shillings.');
  });
});

describe('B1 tools: degraded receipts are traced per rule', () => {
  it('runTools returns the fired rule names', () => {
    const p = TENANTS.growTech();
    const m = createState({ profile: p, callerPhone: PHONE });
    const r = T.runTools({ understanding: { intent: 'ask', answers: ['coverage'], slots: { place: 'Westlands' } }, machine: m, profile: p, lang: 'en', text: 'do you come to Westlands?', now: NOW });
    assert.deepEqual(r.degraded, ['UNCONFIRMED_AREAS_NO_VERDICT']);
    const cov = r.receipts.find((x) => x.tool === 'coverage');
    assert.equal(cov.covered, 'unknown');
    assert.equal(cov.fee_kes, null);
  });
});
