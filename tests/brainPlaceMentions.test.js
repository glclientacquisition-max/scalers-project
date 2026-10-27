'use strict';
// AI-first place mentions (Alvin 2026-10-25 13:36 EAT). Regression for the rogue staging calls on f87866e8:
//   HD_7a9915837b00 (13:29 EAT) "Deep cleaning nipo saa ngapi?" -> "hatufiki" Kutus, Nyali, Siaya + 7 unsorted days of hours
//   HD_ef5ee3a15a0a (13:15 EAT) "Nilikuwa nataka kujua venye nyinyi mnafanyanga kazi," -> "hatufiki" West Pokot / Banana
// One placeMentions() (areaCoverage.js) feeds the coverage lookup, the owed answers and the guard. EN + SW.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const AC = require('../src/conversation/v2/areaCoverage');
const ML = require('../src/conversation/v2/modelLead');
const OW = require('../src/conversation/v2/owed');
const FR = require('./fixtures/dndSimTenant.json');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };
const U = (o = {}) => ({ lang: 'sw', intents: ['ask'], questions: [], slots: { places: [], services: [] }, ...o });
const names = (t, o) => AC.placeMentions(t, o).map((m) => m.name);

// caller lines and the model's own sentences from both calls (voice_turn_traces, staging)
const CALLER_7A99 = 'Deep cleaning nipo saa ngapi?';
const DRAFT_7A99 = 'Sina hakika kuhusu saa ya usafi wa kina kwa sasa, naomba niwaulize timu yetu ili wathibitishe.';
const CALLER_EF5E = 'Ah, tafadhali shh, nilikuwa nataka— Nilikuwa nataka kujua venye nyinyi mnafanyanga kazi,';
const DRAFT_EF5E_T3 = 'Sawa, pokea salamu zangu.';
const DRAFT_EF5E_T6 = 'Tunatoa huduma za usafi wa nyumba na ofisi, na unaweza kulipa baada ya kazi au kwa kuweka amana.';

/** reply(pack) -> reply text; understand -> understanding | 'fail' (flash-lite returned null on HD_7a99). */
async function turn(text, { lang = 'sw', understand = () => 'fail', reply = () => 'fail', profile = P } = {}) {
  const stages = [];
  const streamFor = () => async ({ request, onText }) => {
    const pack = JSON.parse(request.contents[0].parts[0].text);
    const out = pack.UNDERSTAND ? understand(pack.CALLER_SAID) : reply(pack);
    if (out === 'fail') throw Object.assign(new Error('gemini http 503'), { code: 'http_503' });
    const str = JSON.stringify(pack.UNDERSTAND ? out : { reply: out, tool_calls: [] });
    onText(str); return { text: str };
  };
  const live = createBrainV2Live({ env: ENV, applyTools: async (a) => ({ results: [{ action: Object.keys(a)[0], ok: true, status: 'ok', id: 'x' }] }), modelLeadStreamFor: streamFor, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T10:29:00Z'), log: () => {}, onModelStage: (s) => stages.push(s), callerFile: { contactName: null, callerPhone: '+254790381872', openRows: [] } });
  const said = []; const r = await live.run({ text, profile, langLock: lang, onSentence: (s) => said.push(s.text) });
  return { heard: said.join(' ') || r.line || '', stage: stages.filter((s) => s.kind === 'model_lead').slice(-1)[0] };
}
const PHANTOM = /hatufiki|don'?t cover|Kutus|Nyali|Siaya|West Pokot|Banana|Watamu|Maua/i;

test('treeMatch reports a fuzzy hit; strict mode never fuzzes', () => {
  const m = AC.treeMatch('ngapi');
  assert.ok(!m || m.fuzzy === true, JSON.stringify(m));
  assert.equal(AC.treeMatch('ngapi', { fuzzy: false }), null);
  assert.equal(AC.treeMatch('Kileleshwa', { fuzzy: false }).fuzzy, false);
});

test('HD_7a9915837b00 + HD_ef5ee3a15a0a: Swahili words are never places (caller lines AND the model drafts)', () => {
  for (const t of [CALLER_7A99, DRAFT_7A99, CALLER_EF5E, DRAFT_EF5E_T3, DRAFT_EF5E_T6, 'Mnafungua saa ngapi kesho?', 'Bei ya deep clean ni ngapi?']) {
    assert.deepEqual(names(t), [], t);
    assert.deepEqual(names(t, { u: U() }), [], `${t} (model places [])`);
    assert.deepEqual(ML.coverageFor(t, P).places, [], t);
    assert.deepEqual(ML.placeCandidates(t), [], t);
  }
  // the guard's model-sentence scan is strict too (the old m.said self-compare let fuzzy hits through)
  for (const t of [DRAFT_7A99, DRAFT_EF5E_T3, DRAFT_EF5E_T6]) assert.deepEqual(ML.scanPlaces(t.split(/\s+/)), [], t);
});

test('the model is the primary signal: its places count only when the caller said them', () => {
  assert.deepEqual(names(CALLER_7A99, { u: U({ slots: { places: ['Nyali'] } }) }), [], 'model-hallucinated Nyali is rejected');
  const rejected = []; AC.placeMentions(CALLER_7A99, { u: U({ slots: { places: ['Nyali'] } }), rejected }); assert.deepEqual(rejected, ['Nyali']);
  assert.deepEqual(names('nipo Kilileshwa', { u: U({ slots: { places: ['Kileleshwa'] } }) }), ['Kileleshwa'], 'STT spelling confirmed only for a model-named place');
  assert.deepEqual(names('Natafuta usafi pale Westie', { u: U({ slots: { places: ['Westie'] } }) }), ['Westlands'], 'a model place said as an alias (Westie) resolves to the tree node');
});

test('true positives still work (EN + SW): Niko Syokimau, I\'m in Thika, near Kamakis, Kibera exclusion', () => {
  assert.deepEqual(names('Niko Syokimau'), ['Syokimau']);
  assert.deepEqual(names("I'm in Thika"), ['Thika']);
  assert.deepEqual(names('I am in Kibera'), ['Kibera']);
  assert.deepEqual(names('Mnafika Kilimani Westlands?'), ['Kilimani', 'Westlands']);
  assert.deepEqual(names('Ongata Rongai or Kileleshwa? Do you guys go there?'), ['Ongata Rongai', 'Kileleshwa']);
  assert.deepEqual(names('Niko Kileleshwani'), ['Kileleshwa']);
  assert.deepEqual(names('I stay near Sarit Centre').length, 1);
  assert.equal(AC.resolve('Niko Syokimau', P).status, 'covered');
  assert.match(AC.line(AC.resolve('Niko Syokimau', P), 'sw'), /Ndio, tunafika Syokimau/);
  assert.match(AC.line(AC.resolve("I'm in Thika", P), 'en'), /Yes, we cover Thika/);
  assert.equal(AC.resolve('I am in Kibera', P).status, 'excluded');
  assert.match(AC.line(AC.resolve('Niko Kibera', P), 'sw'), /Samahani, hatufiki Kibera/);
  const kam = ML.coverageFor('I stay near Kamakis', P).places; // not on Desk's tree: one honest row, never a yes, never a guessed place
  assert.equal(kam.length, 1, JSON.stringify(kam)); assert.equal(kam[0].place, 'Kamakis'); assert.notEqual(kam[0].covered, 'yes');
});

test('owed coverage only for caller places; never for rows the guard saw in the model reply', () => {
  const q = []; ML.owedCoverageQuestion(q, ML.coverageFor(CALLER_7A99, P).places, CALLER_7A99, {}); assert.deepEqual(q, []);
  const q2 = []; ML.owedCoverageQuestion(q2, ML.coverageFor('Niko Syokimau', P).places, 'Niko Syokimau', {}); assert.equal(q2[0].type, 'coverage');
  assert.deepEqual(ML.owedCoverageQuestion([], [{ place: 'Kutus', covered: 'no' }], CALLER_7A99, {}), [], 'a row not from the caller owes nothing');
});

test('HD_7a9915837b00 replay (SW): understanding null, model hedge -> no phantom "hatufiki", hours once, grouped', async () => {
  const r = await turn(CALLER_7A99, { reply: () => DRAFT_7A99 });
  assert.doesNotMatch(r.heard, PHANTOM, r.heard);
  assert.ok((r.heard.match(/Jumatatu|Jumanne|Jumatano|Alhamisi|Ijumaa|Jumamosi|Jumapili/g) || []).length <= 2, r.heard);
  assert.deepEqual(r.stage.receipts.coverage, [], JSON.stringify(r.stage.receipts));
});

test('HD_7a9915837b00 replay with the understanding (hours question, places [])', async () => {
  const r = await turn(CALLER_7A99, { understand: () => U({ questions: [{ type: 'hours', subject: 'deep cleaning' }] }), reply: () => DRAFT_7A99 });
  assert.doesNotMatch(r.heard, PHANTOM, r.heard);
});

test('HD_ef5ee3a15a0a replay (T3 + T6): the model\'s own words never become places', async () => {
  for (const d of [DRAFT_EF5E_T3, DRAFT_EF5E_T6]) {
    const r = await turn(CALLER_EF5E, { understand: () => U({ questions: [{ type: 'hours', subject: 'kazi' }] }), reply: () => d });
    assert.doesNotMatch(r.heard, PHANTOM, r.heard);
    assert.ok(!r.stage.verdicts.some((v) => /coverage_mismatch/.test(v.reason || '')), JSON.stringify(r.stage.verdicts));
  }
});

test('a model sentence naming a place the caller never said is dropped, not repaired into a claim', async () => {
  const r = await turn(CALLER_7A99, { understand: () => U({ questions: [{ type: 'hours' }] }), reply: () => 'Samahani, hatufiki Kutus. Tuko wazi kila siku.' });
  assert.doesNotMatch(r.heard, /Kutus|hatufiki/i, r.heard);
  assert.ok(r.stage.verdicts.some((v) => v.verdict === 'drop' && /^unasked_place:Kutus/.test(v.reason || '')), JSON.stringify(r.stage.verdicts));
});

test('true-positive turns (EN + SW): coverage still answered from the picks', async () => {
  const a = await turn('Niko Syokimau, mnafika?', { understand: () => U({ questions: [{ type: 'coverage' }], slots: { places: ['Syokimau'] } }), reply: () => 'fail' });
  assert.match(a.heard, /tunafika Syokimau/i, a.heard);
  const b = await turn("I'm in Thika, do you come?", { lang: 'en', understand: () => U({ lang: 'en', questions: [{ type: 'coverage' }], slots: { places: ['Thika'] } }), reply: () => 'fail' });
  assert.match(b.heard, /we cover Thika/i, b.heard);
  const c = await turn('I am in Kibera', { lang: 'en', understand: () => 'fail', reply: () => 'fail' });
  assert.match(c.heard, /don'?t cover Kibera/i, c.heard);
  const d = await turn('Niko Syokimau', { understand: () => 'fail', reply: () => 'Sawa.' });
  assert.match(d.heard, /tunafika Syokimau/i, d.heard);
});

test('owed hours: the asked day only; otherwise grouped in week order as spoken times (EN + SW)', () => {
  const days = { mon: { open: '07:30', close: '18:00' }, tue: { open: '07:30', close: '18:00' }, wed: { open: '07:30', close: '18:00' }, thu: { open: '07:30', close: '18:00' }, fri: { open: '07:30', close: '18:00' }, sat: { open: '08:00', close: '14:00' }, sun: { open: null, close: null } };
  // stored out of order, like the staging row (Ijumaa first)
  const prof = { hoursSchedule: { days: { fri: days.fri, mon: days.mon, wed: days.wed, sat: days.sat, tue: days.tue, thu: days.thu, sun: days.sun } } };
  const R = (text, lang) => OW.render({ topic: 'hours', lang }, { profile: prof, text, now: new Date('2026-10-25T10:29:00Z') });
  assert.equal(R('What are your hours?', 'en'), "We're open Monday to Friday, 7:30 AM to 6 PM; Saturday, 8 AM to 2 PM. Closed Sunday.");
  assert.equal(R(CALLER_7A99, 'sw'), 'Tuko wazi Jumatatu hadi Ijumaa, saa moja na nusu asubuhi hadi saa kumi na mbili jioni; Jumamosi, saa mbili asubuhi hadi saa nane mchana. Jumapili tumefunga.');
  assert.equal(R('Are you open Saturday?', 'en'), "On Saturday we're open 8 AM to 2 PM.");
  assert.equal(R('Mnafungua Jumapili?', 'sw'), 'Jumapili tumefunga.');
  assert.equal(R('Kesho mnafungua saa ngapi?', 'sw'), 'Jumatatu tuko wazi saa moja na nusu asubuhi hadi saa kumi na mbili jioni.', 'kesho from Sunday 25 Oct (EAT) = Monday');
});
