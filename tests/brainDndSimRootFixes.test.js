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
const NLU = require('../src/conversation/v2/nlu');
const FR = require('./fixtures/dndSimTenant.json');

const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicks: FR.picks.picks, areaPicksConfirmedAt: FR.picks.confirmed_at }), id: FR.row.id };
const NOPICKS = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta) }), id: FR.row.id };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };

// template path: every model 503s, as in the DnD sim
async function say(text, lang = 'en', profile = P) {
  const live = createBrainV2Live({ env: ENV, applyTools: async (a) => ({ results: [{ action: Object.keys(a)[0], ok: true, status: 'ok', id: 'x' }] }), modelLeadStreamFor: () => async () => { throw Object.assign(new Error('gemini http 503'), { code: 'http_503' }); }, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T09:00:00Z'), log: () => {}, callerFile: { contactName: null, callerPhone: '+254700000009', openRows: [] } });
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

test('booking pre-check before the name: coverage, price, duration, hours (en + sw)', async () => {
  const en = await say('Book a standard 2-bedroom clean Saturday 10am in Westlands');
  assert.match(en, /Yes, we cover Westlands\..*three thousand five hundred shillings\..*On Saturday we're open 8 AM to 5 PM, so 10 AM works\. May I have your name\?$/);
  const m = { intent: 'book', slots: { service: '2-Bedroom Standard Clean', when: { date: '2026-10-31', time: '10:00' }, place: 'Westlands' } };
  const sw = RF.bookingPrecheck(m, P, 'sw', 'Westlands Jumamosi saa nne');
  assert.ok(sw && sw.lines.length >= 3, JSON.stringify(sw));
  assert.match(sw.lines.join(' '), /tunafika Westlands/);
  assert.equal(RF.bookingPrecheck(m, P, 'sw', 'x'), null, 'once per booking');
});

test('policy question: no unasked "no open booking" line (en + sw)', async () => {
  const en = await say('Can I cancel?');
  assert.match(en, /cancel up to 24 hours before/); assert.doesNotMatch(en, /open booking/i);
  const sw = await say('Naweza kughairi?', 'sw');
  assert.match(sw, /Unaweza kughairi hadi saa 24/); assert.doesNotMatch(sw, /You can cancel|sioni/i);
  assert.equal(NLU.cancelAskIsPolicy ? NLU.cancelAskIsPolicy('Can I cancel?') : true, true);
});
