'use strict';
// DnD 10-question sim root fixes: one assembler dedupe, one payment fact, place statements owed coverage,
// quantity x unit price, booking pre-check, confirmed area picks as the single coverage source. EN + SW.
const test = require('node:test');
const assert = require('node:assert/strict');
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1', VOICE_AREA_FEES: 'on' })) process.env[k] = v;
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const AC = require('../src/conversation/v2/areaCoverage');
const RF = require('../src/conversation/v2/replyFacts');
const OF = require('../src/conversation/v2/ownerFacts');
const OW = require('../src/conversation/v2/owed');
const CP = require('../src/conversation/v2/callPlan');
const ML = require('../src/conversation/v2/modelLead');
const FR = require('./fixtures/dndSimTenant.json');

const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicks: FR.picks.picks, areaPicksConfirmedAt: FR.picks.confirmed_at }), id: FR.row.id };
const NOPICKS = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta) }), id: FR.row.id };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };

// template path: every model 503s, as in the DnD sim
async function say(text, lang = 'en', profile = P, { rows = [], u = null } = {}) {
  // the reply model always fails (template path); the understanding call answers with `u` when given
  const stream = () => async ({ request }) => { const p = JSON.parse(request.contents[0].parts[0].text); if (p.UNDERSTAND && u) return { text: JSON.stringify(u) }; throw Object.assign(new Error('gemini http 503'), { code: 'http_503' }); };
  const live = createBrainV2Live({ env: ENV, applyTools: async (a) => ({ results: [{ action: Object.keys(a)[0], ok: true, status: 'ok', id: 'x' }] }), modelLeadStreamFor: stream, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T09:00:00Z'), log: () => {}, callerFile: { contactName: null, callerPhone: '+254700000009', openRows: rows } });
  const said = []; const r = await live.run({ text, profile, langLock: lang, onSentence: (s) => said.push(s.text) });
  return said.join(' ') || r.line || '';
}
const count = (s, re) => (s.match(re) || []).length;

test('dedupe by fact: one price, said once (en + sw)', async () => {
  const en = await say('How much is a deep clean?');
  assert.equal(count(en, /six thousand shillings/g), 1, en);
  const sw = await say('Deep clean ni pesa ngapi?', 'sw');
  assert.ok(count(sw, /elfu sita/g) <= 1, sw);
  const a = RF.createAssembler({ profile: P, lang: 'en' });
  assert.ok(a.admit('Sofa Cleaning is KSh 700 per seat.'));
  assert.equal(a.admit('Sofa Cleaning is KSh 700 per seat.'), '');
});

test('quantity x unit price from the catalogue (en + sw)', async () => {
  const en = await say('Sofa cleaning for a 5-seater, how much?');
  assert.match(en, /three thousand five hundred shillings for 5 seats/);
  assert.equal(count(en, /seven hundred shillings per seat/g), 1, en);
  const svc = P.servicesCatalog.find((s) => /sofa/i.test(s.name));
  assert.match(RF.priceLine(svc, 'sofa ya viti 5', 'sw').text, /5 ni KSh 3,500/);
});

test('one payment fact: methods + deposit once, never stitched', async () => {
  const pf = OF.paymentFact(OF.ownerFacts(P));
  assert.ok(pf && /M-Pesa/.test(pf.en) && /deposit/.test(pf.en));
  const en = await say('How do I pay?');
  assert.doesNotMatch(en, /We take You can pay/i);
  assert.equal(count(en, /M-Pesa Paybill/g), 1, en);
  assert.equal(count(en, /30% deposit/g), 1, en);
});

test('place statements are owed a coverage answer with the confirmed fee (en + sw)', async () => {
  assert.match(await say("I'm in Syokimau"), /Yes, we cover Syokimau\. There's an extra five hundred shillings/);
  const th = await say("I'm in Thika");
  assert.match(th, /cover Thika.*one thousand five hundred shillings.*2 bedrooms/);
  assert.match(await say('Niko Syokimau', 'sw'), /Ndio, tunafika Syokimau\. Kuna ada ya ziada ya shilingi mia tano/);
  const near = await say("I'm near Kamakis");
  assert.match(near, /Which area is that near\?/); assert.doesNotMatch(near, /Yes, we cover/);
  assert.equal(count(near, /\?/g), 1, near);
});

test('confirmed picks are the single coverage source: Kamakis, Kibera exclusion', async () => {
  assert.doesNotMatch(await say('Do you come to Kamakis?'), /Yes, we cover Kamakis/);
  assert.match(await say('Do you cover Kibera?'), /Sorry, we don't cover Kibera/);
  assert.match(AC.line(AC.resolve('Kibera', P), 'sw'), /Samahani, hatufiki Kibera/);
  assert.equal(AC.resolve('Kibera', P).source, 'picks');
});

test('no-picks tenant: legacy fallback never confirms an unknown place', () => {
  const r = AC.resolve('Kamakis', NOPICKS);
  assert.notEqual(r.status, 'covered');
  assert.match(AC.line(r, 'en'), /team will confirm|Which area/i);
  assert.match(AC.line(r, 'sw'), /Timu itathibitisha|karibu na eneo gani/i);
  // a same-named town row ("Kiambu" the town) does not cover the whole county
  // DnD legacy lists the TOWN Kiambu, not the county: Limuru (Kiambu county, unlisted) is not covered
  assert.notEqual(AC.resolve('Limuru', NOPICKS).status, 'covered');
  // a known county where the owner lists nothing stays an honest no
  assert.equal(AC.resolve('Kericho', NOPICKS).status, 'outside');
});

test('call plan owes the booking confirmations before the name, once, in the turn language (en + sw)', async () => {
  const en = await say('Book a standard 2-bedroom clean Saturday 10am in Westlands');
  assert.match(en, /Yes, we cover Westlands\..*three thousand five hundred shillings\..*It takes about 3-4 hours\..*On Saturday we're open 8 AM to 5 PM, so 10 AM works\. May I have your name\?$/);
  const sw = await say('Nataka 2-bedroom standard clean Jumamosi saa nne asubuhi Westlands', 'sw');
  assert.match(sw, /Ndio, tunafika Westlands\..*elfu tatu na mia tano\..*Inachukua takriban saa 3-4\..*Jumamosi tuko wazi.*Naomba jina lako\?$/);
  const st = { intent: 'book', slots: { service: '2-Bedroom Standard Clean', when: { date: '2026-10-31', time: '10:00' }, place: 'Westlands' } };
  const o = CP.owed(st, P, { kind: 'ask', slot: 'name' });
  assert.deepEqual(o.items.map((x) => x.topic), ['coverage', 'price', 'duration', 'hours_fit']);
  CP.markOwed(st, o);
  assert.equal(CP.owed(st, P, { kind: 'ask', slot: 'name' }), null, 'once per booking');
  assert.equal(CP.owed({ ...st, confirmedFor: null }, P, { kind: 'ask', slot: 'date' }), null, 'only before the name / read-back');
  const kib = CP.owed({ intent: 'book', slots: { ...st.slots, place: 'Kibera' } }, P, { kind: 'ask', slot: 'name' });
  assert.equal(kib.blocked, true);
});

test('every owed-answer type renders in Swahili, scoped to its sub-question (no extra sub-topics)', () => {
  const ctx = { profile: P, text: 'sofa viti 5', machine: { slots: {} }, caller: { candidate: 'Wanjiru', upcoming: [{ service: 'Sofa Cleaning', date: '2026-10-26' }] } };
  const kib = ML.coverageFor('Kibera', P).places[0];
  const SAMPLE = {
    coverage: { sub: 'Kibera', row: kib }, price: { sub: 'Sofa Cleaning' }, payment: {}, policy: { sub: 'cancellation' }, hours: {},
    duration: { sub: '2-Bedroom Standard Clean' }, hours_fit: { date: '2026-10-31', time: '10:00' }, identity: {}, booking_status: {}, clarify: { sub: 'cancel' },
  };
  assert.deepEqual(Object.keys(SAMPLE).sort(), [...OW.TOPICS].sort(), 'a new owed-answer type needs a sample here (and an sw rendering)');
  const EN_WORDS = /\b(the|we|you|our|is|are|and|it|have|cover|pay|takes|open)\b/i;
  for (const t of OW.TOPICS) {
    const sw = OW.render({ topic: t, lang: 'sw', ...SAMPLE[t] }, ctx); const en = OW.render({ topic: t, lang: 'en', ...SAMPLE[t] }, ctx);
    assert.ok(sw && en, `${t}: en+sw render`);
    assert.notEqual(sw, en, `${t}: sw differs from en`);
    assert.doesNotMatch(sw.replace(/M-Pesa[^.]*|Standard Clean|Sofa Cleaning|Buy Goods|Till|Paybill|with your phone number as the account|or cash/gi, ''), EN_WORDS, `${t}: no English leak in "${sw}"`);
  }
  // scoped: the cancellation answer is only the cancellation fact (no reschedule / late-arrival extras)
  const of = OF.ownerFacts(P); const cancel = OF.spoken(of.byTopic.get('cancellation'), 'en');
  assert.equal(OW.render({ topic: 'policy', sub: 'cancellation', lang: 'en' }, ctx), cancel);
  for (const other of of.facts.filter((f) => f.topic !== 'cancellation' && f.family !== 'faq')) assert.ok(!cancel.includes(f0(other.text)), `leaks ${other.topic}`);
  const list = OW.collect({ questions: [{ type: 'policy', subject: 'cancellation' }], text: 'Can I cancel?', profile: P, lang: 'sw' });
  assert.deepEqual(list.map((o) => `${o.topic}:${o.sub}:${o.lang}`), ['policy:cancellation:sw']);
});
const f0 = (t) => String(t || '').split(/(?<=[.!?])\s/)[0];

test('Swahili not-covered reply follows the turn language through the call plan', async () => {
  assert.equal(await say('Mnafika Kibera?', 'sw'), 'Samahani, hatufiki Kibera. Kazi iko eneo lingine?');
  assert.equal(await say('Do you cover Kibera?', 'en'), "Sorry, we don't cover Kibera. Is the job anywhere else?");
});

const MON = [{ id: 'r1', caller_phone: '+254700000009', service_name: '2-Bedroom Standard Clean', status: 'confirmed', window_start: '2026-10-26T07:00:00Z', place: 'Westlands' }];
test('cancel question vs request: no understanding -> clarify; a named booking -> the request (en + sw)', async () => {
  assert.equal(await say('Can I cancel?'), 'Do you want to cancel a booking, or hear our cancellation policy?');
  assert.equal(await say('Naweza kughairi?', 'sw'), 'Unataka kughairi booking yako, au kujua sera yetu ya kughairi?');
  const en = await say('I want to cancel my Monday booking', 'en', P, { rows: MON });
  assert.match(en, /^Cancel your two bedroom standard clean on Monday 26 October at 10 AM\. Shall I go ahead\?$/);
  const sw = await say('Nataka kughairi booking yangu ya Jumatatu', 'sw', P, { rows: MON });
  assert.match(sw, /^Nifute .*Jumatatu 26 Oktoba.*Niendelee\?$/);
  assert.doesNotMatch(en + sw, /24 hours|saa 24|open booking|Sioni/i);
});

test('cancel question vs request: decided from the understanding (en + sw)', async () => {
  const pol = (lang) => ({ lang, intents: ['ask'], questions: [{ type: 'policy', subject: 'cancellation' }], places: [], booking_ref: null, slots: {} });
  const en = await say('Can I cancel?', 'en', P, { u: pol('en') });
  assert.equal(en, 'You can cancel up to 24 hours before. After that, we keep the deposit.');
  const sw = await say('Naweza kughairi?', 'sw', P, { u: pol('sw') });
  assert.match(sw, /^Unaweza kughairi hadi saa 24 kabla\. Baada ya hapo, amana haitarudishwa\.$/);
  const req = { lang: 'en', intents: ['cancel'], questions: [], places: [], booking_ref: { date: 'Monday' }, slots: {} };
  assert.match(await say('I want to cancel my Monday booking', 'en', P, { u: req, rows: MON }), /Shall I go ahead\?$/);
  assert.equal(ML.cancelKind(pol('en'), {}, 'Can I cancel?', P), 'policy');
  assert.equal(ML.cancelKind(req, {}, 'cancel my Monday booking', P), 'request');
  assert.equal(ML.cancelKind(null, {}, 'Can I cancel?', P, new Date('2026-10-25T09:00:00Z')), 'clarify');
});
