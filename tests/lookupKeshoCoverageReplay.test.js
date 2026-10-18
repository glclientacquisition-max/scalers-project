// Replay of a staging call (HD_17429802746e, 2026-10-19 02:20–02:27 EAT,
// anonymised: "Test Cleaners", agent "Amani", public place names only).
// Three wrong answers, each tested where it broke:
//   1. "I wanted to know if you do Kileleshwa." went to the model (the verb
//      "do" is not a fee phrase); the guard cut "We cover Kileleshwa." and the
//      caller heard a bare "Okay."
//   2. "Mnafungua kesho saa ngapi?" at 02:25 EAT on Monday answered the whole
//      week: the hours lookup had no leo/kesho/today/tomorrow.
//   3. "Na kesho," was not seen as an hours follow-up; the model streamed
//      "KeshoTukowazisaa ... Ungetakalinisetup appointment?" and the lint
//      swapped a two-word glued fragment for the callback line after a real
//      answer had already been spoken.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta, serviceFieldPath, hashFactValue } = require('../src/conversation/provenance');
const { catalogRowFactValue, factValueForPath, tenantRowFromProfile } = require('../src/conversation/factHash');
const { planLookupTurn } = require('../src/conversation/router');
const { lookup } = require('../src/knowledge/lookup');
const { profiles } = require('../evals/replay/profiles');

const ENV = { VOICE_LOOKUPS: 'on' };
const NOW = new Date('2026-10-18T23:07:20.000Z'); // 02:07 EAT, Monday
const CLOSED_HOLD_GATE = {
  allowed: false,
  reasons: [
    'Holds are not enabled in policies.',
    'Need at least one holdable product with owner provenance in the catalog.',
  ],
};
const EN_CB = 'Let me check with the team and get back to you.';
const SW_CB = 'Wacha niulize timu kisha nikujulishe.';

function row() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    business_name: 'Test Cleaners',
    vertical: 'home_services',
    agent_name: 'Amani',
    is_active: true,
    hours_schedule: {
      days: {
        mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' },
        wed: { open: '08:00', close: '17:00' }, thu: { open: '08:00', close: '17:00' },
        fri: { open: '08:00', close: '17:00' }, sat: { open: '09:00', close: '13:00' }, sun: null,
      },
      timezone: 'Africa/Nairobi',
    },
    services_catalog: [
      { id: 'svc_t_fixed', name: 'Carpet Cleaning', price: '2000', pricing_mode: 'fixed', price_range: 'KSh 2,000', source: 'owner' },
      { id: 'svc_t_from', name: 'Sofa Cleaning', price: '1500', pricing_mode: 'from', price_range: 'From KSh 1,500', source: 'owner' },
      { id: 'svc_t_range', name: 'Mattress Cleaning', price: '800', price_max: 1200, pricing_mode: 'range', price_range: 'KSh 800–1,200', source: 'owner' },
      { id: 'svc_t_quote', name: 'Office Deep Clean', price: '', pricing_mode: 'quote', price_range: '', source: 'owner' },
      { id: 'svc_t_ask', name: 'Curtain Cleaning', pricing_mode: 'ask', price_range: 'Ask', source: 'owner' },
    ],
    product_catalog: [],
    business_policies: {},
    service_areas: null,
  };
}

/** Owner meta rows stamped with the live hash, as the Desk save writes them. */
function metaFor(tenantRow) {
  const rows = tenantRow.services_catalog.map((svc, i) => ({
    field_path: serviceFieldPath(i, svc),
    source: 'owner',
    value_hash: hashFactValue(catalogRowFactValue(svc)),
  }));
  const probe = tenantProfileFromRow(tenantRow, {});
  rows.push({
    field_path: 'hours.weekly_grid',
    source: 'owner',
    value_hash: hashFactValue(factValueForPath('hours.weekly_grid', tenantRowFromProfile(probe))),
  });
  return { ...indexFieldMeta(rows), hashMode: true };
}


const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { repairGluedWords } = require('../src/speech/glueRepair');

const CALL_NOW = new Date('2026-10-18T23:25:00.000Z'); // 02:25 EAT, Monday 19 Oct

function liveProfile() {
  const tenantRow = row();
  return tenantProfileFromRow(tenantRow, { fieldMeta: metaFor(tenantRow), holdGate: CLOSED_HOLD_GATE });
}

// The shared replay profile that lists Kileleshwa at KSh 300 (Settings > Locations).
function areaProfile() {
  return profiles().carry;
}

function plan(text, state, language = 'en', profile = liveProfile(), now = CALL_NOW) {
  return planLookupTurn({ text, state, profile, language, now, seed: 0, env: ENV });
}

function polish(text, language, opts = {}) {
  const prev = process.env.VOICE_LOOKUPS;
  process.env.VOICE_LOOKUPS = 'on';
  try {
    return polishSpokenDetail(text, {
      profile: liveProfile(),
      state: { conversation: { answersReceived: [] } },
      language,
      callerTurns: [],
      toolResults: [],
      capabilities: {},
      ...opts,
    });
  } finally {
    if (prev === undefined) delete process.env.VOICE_LOOKUPS;
    else process.env.VOICE_LOOKUPS = prev;
  }
}

// ---------- 1. a named place goes to the area lookup, whatever the verb ----------

test('replay t2: "do you do <place>" is an area lookup, not a model turn (EN and SW)', () => {
  for (const [text, lang, cb] of [
    ['I wanted to know if you do Kileleshwa.', 'en', EN_CB],
    ['Do you do Kileleshwa?', 'en', EN_CB],
    ['Mnafanya Kileleshwa?', 'sw', SW_CB],
    ['Nauliza kama mnaenda Kileleshwa.', 'sw', SW_CB],
  ]) {
    const out = plan(text, { conversation: {} }, lang);
    assert.ok(out && out.handled, `${text} should be handled by the lookup`);
    assert.equal(out.lookups[0].kind || out.lookups[0].type, 'fee', text);
    // No areas on file: the honest answer is the callback line, never "we cover".
    assert.equal(out.speech, cb, text);
    assert.doesNotMatch(out.speech, /\b(we cover|tunafika|okay|sawa)\b/i);
  }
});

test('replay t2: with the place on file the lookup answers the fee', () => {
  const out = plan('I wanted to know if you do Kileleshwa.', { conversation: {} }, 'en', areaProfile());
  assert.ok(out && out.handled);
  assert.match(out.speech, /Kileleshwa/);
  assert.match(out.speech, /300|three hundred/i);
  assert.notEqual(out.speech, EN_CB);
});

test('a place word is not grabbed from statements, names or common words', () => {
  for (const text of [
    'Niko Kileleshwa.',
    'Is Amani there?',
    'Mara ngapi mnafanya usafi?',
    'Can you clean my carpet on Thursday?',
    'I need carpet cleaning.',
  ]) {
    const out = plan(text, { conversation: {} }, 'en');
    const kinds = out ? out.lookups.map((l) => l.kind || l.type) : [];
    assert.ok(!kinds.includes('fee'), `${text} must not route to the area lookup`);
  }
});

test('replay t2 speech: a cut coverage claim becomes the callback line, never a bare Okay/Sawa', () => {
  for (const [text, lang, cb] of [
    ['We cover Kileleshwa.', 'en', EN_CB],
    ['Tunafika Kileleshwa.', 'sw', SW_CB],
  ]) {
    const out = polish(text, lang);
    assert.equal(out.text, cb, text);
    assert.doesNotMatch(out.text, /^(okay|sawa)\.?$/i);
  }
});

test('a cut claim next to a kept sentence keeps the sentence, no callback appended', () => {
  const out = polish('We cover Kileleshwa. What service would you like us to help you with?', 'en');
  assert.equal(out.text, 'What service would you like us to help you with?');
});

// ---------- 2. leo / kesho / today / tomorrow come from the Nairobi date ----------

test('replay t3: "Mnafungua kesho saa ngapi?" at 02:25 EAT Monday answers Tuesday by name', () => {
  const out = plan('Mnafungua kesho saa ngapi?', { conversation: {} }, 'sw');
  assert.ok(out && out.handled);
  assert.equal(out.speech, 'Kesho, Jumanne, tunafungua kutoka saa mbili asubuhi hadi saa kumi na moja jioni.');
});

test('relative days in EN and SW name the day, including a closed day', () => {
  const cases = [
    ['Are you open tomorrow?', 'en', CALL_NOW, 'Tomorrow, Tuesday, we are open from eight AM to five PM.'],
    ['What time do you open today?', 'en', CALL_NOW, 'Today, Monday, we are open from eight AM to five PM.'],
    ['Mko wazi leo?', 'sw', CALL_NOW, 'Leo, Jumatatu, tunafungua kutoka saa mbili asubuhi hadi saa kumi na moja jioni.'],
    // Saturday 24 Oct 21:30 UTC is Sunday 00:30 EAT: "today" is Sunday, closed.
    ['Are you open today?', 'en', new Date('2026-10-24T21:30:00.000Z'), 'Today, Sunday, we are closed.'],
    ['Mnafungua kesho?', 'sw', new Date('2026-10-24T10:00:00.000Z'), 'Kesho, Jumapili, tumefunga.'],
  ];
  for (const [text, lang, now, want] of cases) {
    const out = plan(text, { conversation: {} }, lang, liveProfile(), now);
    assert.ok(out && out.handled, text);
    assert.equal(out.speech, want, text);
  }
});

test('the day comes from Nairobi time, not UTC: 22:30 UTC Sunday is Monday in Nairobi', () => {
  const r = lookup('hours', 'are you open tomorrow', { profile: liveProfile(), language: 'en', now: new Date('2026-10-18T22:30:00.000Z') });
  assert.equal(r.status, 'found');
  assert.equal(r.id, 'hours.tue');
});

// ---------- 3. short follow-ups to an hours question ----------

test('replay t4: "Na kesho," after an hours answer is an hours lookup for Tuesday', () => {
  const state = { conversation: {} };
  const first = plan('Mnafungua saa ngapi?', state, 'sw');
  assert.ok(first && first.handled);
  for (const text of ['Na kesho,', 'Na kesho, saa ngapi?', 'And tomorrow?']) {
    const s = JSON.parse(JSON.stringify(state));
    const out = plan(text, s, text.startsWith('And') ? 'en' : 'sw');
    assert.ok(out && out.handled, text);
    assert.match(out.speech, /^(Kesho, Jumanne,|Tomorrow, Tuesday,)/, text);
  }
  const sat = plan('And Saturday?', JSON.parse(JSON.stringify(state)), 'en');
  assert.equal(sat.speech, 'On Saturday we are open from nine AM to one PM.');
});

test('a day word with no hours topic, or a long turn, is not an hours follow-up', () => {
  assert.equal(plan('Na kesho,', { conversation: {} }, 'sw'), null);
  const state = { conversation: {} };
  plan('Mnafungua saa ngapi?', state, 'sw');
  assert.equal(plan('Can you clean my carpet on Thursday please?', state, 'en'), null);
});

// ---------- 3b. run-together Swahili words and fragments ----------

test('replay t4 speech: glued Swahili is split with the word list', () => {
  const out = repairGluedWords('KeshoTukowazisaa saa mbili asubuhi hadi saa kumi na moja jioni. Ungetakalinisetup appointment?', { language: 'sw' });
  assert.equal(out.text, 'Kesho tuko wazi saa mbili asubuhi hadi saa kumi na moja jioni. Ungetaka lini setup appointment?');
  assert.deepEqual(out.dropped, []);
});

test('glue repair leaves real words, English, brands and fact refs alone', () => {
  for (const [text, lang] of [
    ['Tunakusaidia na usafi wa mazulia.', 'sw'],
    ['Nitakuhakikishia bei kesho.', 'sw'],
    ['We are open from eight AM to five PM.', 'en'],
    ['Tuma kwa WhatsApp au M-Pesa.', 'sw'],
    ['Bei ni {price.svc_t_fixed}.', 'sw'],
  ]) {
    assert.equal(repairGluedWords(text, { language: lang }).text, text, text);
  }
  assert.equal(repairGluedWords('OnTuesday we open at eight.', { language: 'en' }).text, 'On Tuesday we open at eight.');
});

test('a glued sentence that cannot be split is dropped, never spoken', () => {
  const out = repairGluedWords('Tutawasilianabaadayenaweweleo. Asante sana.', { language: 'sw' });
  assert.equal(out.text, 'Asante sana.');
  assert.equal(out.dropped.length, 1);
});

test('no streamed sentence keeps a glued token after polish', () => {
  const out = polish('KeshoTukowazisaa saa mbili asubuhi. Ungetakalinisetup appointment?', 'sw', { spokenThisTurn: true });
  for (const word of out.text.split(/[^A-Za-z]+/)) assert.ok(word.length <= 14, `glued token left: ${word}`);
  assert.doesNotMatch(out.text, /Wacha niulize timu/);
});

test('a failed fragment is dropped; the callback line only when nothing else was said', () => {
  const after = polish('na kesho.', 'sw', { spokenThisTurn: true });
  assert.equal(after.text, '');
  assert.ok(after.dropReasons.includes('sentence_fragment'));
  const glued = polish('Tutawasilianabaadayenaweweleo.', 'sw', { spokenThisTurn: true });
  assert.equal(glued.text, '');
  const first = polish('na kesho.', 'sw', { spokenThisTurn: false });
  assert.equal(first.text, SW_CB);
  const kept = polish('Sawa. na kesho. Ungependa kuweka miadi?', 'sw', { spokenThisTurn: false });
  assert.doesNotMatch(kept.text, /Wacha niulize timu/);
  assert.match(kept.text, /Ungependa kuweka miadi\?/);
});
