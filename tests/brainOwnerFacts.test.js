'use strict';
// B1/B2 (audit 2026-10-25_desk-production-readiness): ONE owner-fact projection read by every Brain path
// (v1 draft fact note, call core answers, model lead KB) and by their fact checkers; areas only after confirmed_at.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const OF = require('../src/conversation/v2/ownerFacts');
const F = require('../src/conversation/v2/v1draftFacts');
const VER = require('../src/conversation/v2/v1draftVerify');
const CC = require('../src/conversation/v2/callCore');
const ML = require('../src/conversation/v2/modelLead');
const AC = require('../src/conversation/v2/areaCoverage');
const AP = require('../src/conversation/v2/areaPicks');
const TAX = require('../src/data/taxonomy.json');

const OWNER = { source: 'owner', confirmed: true };
const DND = {
  id: 't-dnd', businessName: 'Done and Dusted', agentName: 'Shiru',
  businessPolicies: {
    payment: 'You can pay by M-Pesa paybill 247247.',
    cancellation: 'Customers can cancel up to a day before at no charge. Customers can move a booking up to 6 hours before. We wait 15 minutes if the customer is late or not in. After that, a KSh 500 call-out fee applies.',
    provenance: { payment: OWNER, cancellation: OWNER },
    policy_lines: { warranty: { en: "We don't give a guarantee.", sw: 'Hatutoi dhamana.' } },
    rules: { warranty: { answer: 'no', none: true }, returns: { mode: 'custom', note: 'We redo any spot you are not happy with within 2 days.', note_sw: 'Tunarudia sehemu yoyote usiyoridhika nayo ndani ya siku 2.' }, delivery: { mode: 'custom', note: 'We bring all equipment.' } },
  },
  faqs: [{ question: 'Do you bring your own detergents?', answer: 'Yes, we bring eco-friendly detergents.', source: 'owner', confirmed: true }],
  servicesCatalog: [],
};

// ---- the contract: every editable Desk policy field reaches the builder ----
function deskPolicyFields() {
  const reg = fs.readFileSync(path.join(__dirname, '../dashboard/src/lib/fieldPathRegistry.ts'), 'utf8');
  const m = reg.match(/\^policies\\\.\(([^)]+)\)\$/);
  assert.ok(m, 'fieldPathRegistry.ts policies pattern not found');
  return m[1].split('|').map((x) => x.replace(/\\\./g, '.'));
}
// fields that are not spoken policy text, with the reason (anything else MUST produce a fact)
const NOT_SPOKEN = {
  coverage_areas: 'areas: tenant_area_picks (B2), not a policy sentence',
  'holds.allowed': 'part of holds (asserted via holds)',
  booking_mode: 'behaviour toggle (confirmed slot vs request), never spoken',
};
function fixtureFor(field) {
  if (field === 'holds') return { holds: { allowed: 'yes', max_hours: 24, deposit_required: 'yes', source: 'owner', confirmed: true } };
  return { [field]: `Owner text for ${field} 7.`, provenance: { [field]: OWNER } };
}

test('contract: every editable Desk policy field (fieldPathRegistry) is in the builder output', () => {
  const fields = deskPolicyFields();
  assert.ok(fields.length >= 8, fields.join(','));
  for (const field of fields) {
    if (NOT_SPOKEN[field]) continue;
    const of = OF.ownerFacts({ businessPolicies: fixtureFor(field) });
    assert.ok(of.byTopic.has(field), `Desk field policies.${field} missing from ownerFacts`);
  }
});

test('contract: every per-trade registry topic (taxonomy policy_topics) reaches the builder, incl. none and custom', () => {
  for (const t of TAX.policy_topics) {
    const none = OF.ownerFacts({ businessPolicies: { rules: { [t.id]: { mode: 'none' } } } });
    assert.ok(none.byTopic.has(t.id), `none ${t.id}`);
    const custom = OF.ownerFacts({ businessPolicies: { rules: { [t.id]: { mode: 'custom', note: `Own words for ${t.id}.`, note_sw: `Maneno ya ${t.id}.` } } } });
    assert.equal(custom.byTopic.get(t.id).text, `Own words for ${t.id}.`);
    assert.equal(OF.spoken(custom.byTopic.get(t.id), 'sw'), `Maneno ya ${t.id}.`);
  }
});

test('contract: payments.methods (typed) and FAQs (faqs.N) reach the builder', () => {
  const of = OF.ownerFacts(DND);
  assert.match(of.byTopic.get('payment').text, /247247/);
  assert.equal(of.byTopic.get('payment').id, 'M1');
  assert.equal(of.faqs.length, 1);
  assert.equal(of.faqs[0].id, 'F1');
});

test('niche-agnostic: an unknown topic from the registry/rules and an extra text key are facts', () => {
  const of = OF.ownerFacts({ businessPolicies: { parking_rules: 'Park at gate B.', provenance: { parking_rules: OWNER }, rules: { pets: { mode: 'custom', note: 'No pets inside the salon.' } } } });
  assert.ok(of.byTopic.has('pets'));
  assert.ok(of.byTopic.has('parking_rules'));
  assert.deepEqual(OF.match('can I bring my pets', of).map((f) => f.topic), ['pets']);
  const src = fs.readFileSync(path.join(__dirname, '../src/conversation/v2/ownerFacts.js'), 'utf8');
  assert.ok(!/home_services|cleaning|salon|retail/i.test(src), 'no trade list in the builder');
});

test('unconfirmed policy text stays out (provenance gate), confirmed is in', () => {
  const of = OF.ownerFacts({ businessPolicies: { returns: 'Seed text we never confirmed.', provenance: { returns: { source: 'seed' } } } });
  assert.ok(!of.byTopic.has('returns'));
});

test('long text is split into whole sentences, never truncated', () => {
  const long = Array.from({ length: 12 }, (_, i) => `Rule number ${i + 1} applies to every booking we take.`).join(' ');
  assert.ok(long.length > 500);
  const of = OF.ownerFacts({ businessPolicies: { cancellation: long, provenance: { cancellation: OWNER } } });
  const f = of.byTopic.get('cancellation');
  assert.equal(f.text, long);
  assert.equal(f.sentences.length, 12);
  assert.ok(f.nums.includes('12'));
});

// ---- every path reads it ----
test('v1 draft fact note carries every policy topic + FAQ; verifier passes a cited policy sentence and its number', () => {
  const note = F.buildFactNote(DND, {});
  const fams = note.facts.map((f) => `${f.id}:${f.family}`);
  for (const id of ['M1:payment', 'F1:faq']) assert.ok(fams.includes(id), fams.join(','));
  const cancel = note.facts.find((f) => f.topic === 'cancellation');
  assert.ok(cancel && /cancel/.test(note.text));
  const v = VER.verifySentence({ text: 'After that, a KSh 500 call-out fee applies.', refs: [cancel.id] }, note, { profile: DND });
  assert.equal(v.verdict, 'pass', JSON.stringify(v));
  const bad = VER.verifySentence({ text: 'After that, a KSh 900 call-out fee applies.', refs: [cancel.id] }, note, { profile: DND });
  assert.equal(bad.verdict, 'replace');
  const faq = note.facts.find((f) => f.family === 'faq');
  assert.equal(VER.verifySentence({ text: 'Yes, we bring eco-friendly detergents.', refs: [faq.id] }, note, { profile: DND }).verdict, 'pass');
});

const machine = () => ({ slots: {}, receipts: [] });
for (const [lang, ask, want] of [
  ['en', 'what if I am late?', /15 minutes/],
  ['en', 'do you give a guarantee?', /don't give a guarantee/],
  ['en', 'I wanted to know do you bring your own detergents', /eco-friendly detergents/],
  ['sw', 'je mnatoa dhamana?', /Hatutoi dhamana/],
  ['sw', 'nataka kujua kuhusu kurudisha', /Tunarudia sehemu/],
  ['sw', 'mnaleta vifaa? delivery je?', /^Timu itathibitisha\.$/],
]) {
  test(`[${lang}] call core answers the policy/FAQ question from the shared builder: "${ask}"`, () => {
    const out = CC.answers([], ask, machine(), DND, lang);
    const a = out.find((x) => String(x.ask).startsWith('owner:'));
    assert.ok(a, JSON.stringify(out));
    assert.match(a.text, want);
  });
}

test('call core check (shared policy checker) repairs an invented policy number with the owner sentence', () => {
  const rp = CC.replyPlan({ st: { kind: 'question', question: 'Which day works?' }, tmpl: 'Which day works?', ans: [], lead: null, receipts: [], lang: 'en', profile: DND });
  const r = rp.check('You can cancel up to 48 hours before.');
  assert.equal(r.verdict, 'replace');
  assert.match(r.text, /a day before/);
});

test('model lead KB carries every policy + FAQ; its verifier repairs an unbacked policy number and passes a backed fee', () => {
  const k = ML.kb(DND);
  assert.match(k.payment, /247247/);
  for (const t of ['cancellation', 'warranty', 'returns', 'delivery']) assert.ok(k.policies[t], t);
  assert.deepEqual(k.policies.returns, { en: DND.businessPolicies.rules.returns.note, sw: DND.businessPolicies.rules.returns.note_sw });
  assert.equal(k.faqs[0].q, 'Do you bring your own detergents?');
  const ctx = { st: { kind: 'question' }, receipts: [], coverage: [], caller: { candidate: null, upcoming: [] }, profile: DND, questions: [{ type: 'policy' }], lang: 'en', machine: machine(), text: 'what if I am late' };
  const v = ML.makeVerifier(ctx);
  assert.equal(v.check('After that, a KSh 500 call-out fee applies.').verdict, 'pass');
  const bad = v.check('We wait 30 minutes if you are late.');
  assert.equal(bad.verdict, 'repair'); assert.match(bad.fix, /15 minutes/);
  const owed = ML.owedAnswers(ctx, 'Which day works?');
  assert.ok(owed.some((o) => /15 minutes/.test(o.text)), JSON.stringify(owed));
});

test('Kiswahili: none speaks Desk\'s policy_lines sw; custom without note_sw falls back to "Timu itathibitisha."', () => {
  const of = OF.ownerFacts(DND);
  assert.equal(OF.spoken(of.byTopic.get('warranty'), 'sw'), 'Hatutoi dhamana.');
  assert.equal(OF.spoken(of.byTopic.get('delivery'), 'sw'), 'Timu itathibitisha.');
  assert.equal(OF.spoken(of.byTopic.get('delivery'), 'en'), 'We bring all equipment.');
  assert.equal(OF.SW_FALLBACK, 'Timu itathibitisha.');
});

// ---- B2: areas only after confirmed_at ----
const PICKS = { version: 1, tree_version: 'ke-areas-2026-10-24.1', picks: [{ node: 'county:nairobi', serve: true }] };
const needTree = { skip: !AP.available() && 'Desk tree (#930) not on this branch' };
test('B2: unconfirmed picks are never spoken (team confirms, no legacy fallback); confirmed picks are', needTree, () => {
  const pending = { ...DND, areaPicks: PICKS, areaPicksConfirmedAt: null, serviceAreas: { areas: [{ id: 'place:kileleshwa' }] } };
  const r = AC.resolve('do you do Kileleshwa?', pending);
  assert.equal(r.status, 'unknown'); assert.equal(r.via, 'unconfirmed');
  assert.match(AC.line(r, 'en'), /team will confirm/); assert.match(AC.line(r, 'sw'), /Timu itathibitisha/);
  assert.deepEqual(AC.listed(pending).serve, []);
  assert.ok(!F.buildFactNote(pending, {}).facts.some((f) => f.family === 'area' && f.covered));
  const cc = CC.answers([{ type: 'ask', ask: 'coverage' }], 'which areas do you cover?', machine(), pending, 'en');
  assert.match(cc.find((a) => a.ask === 'coverage').text, /team will confirm/);
  const ok = { ...pending, areaPicksConfirmedAt: '2026-10-25T08:00:00Z' };
  assert.equal(AC.resolve('do you do Kileleshwa?', ok).status, 'covered');
});

// ---- Desk review of #937 (#938): own-topic facts, policy_lines wording, pickup_only ----
// Desk-shaped saves (policyRegistry.ts): rule + policy_lines + rebuilt cancellation text key.
const LINE = {
  cancellation: { yes: { r: { answer: 'yes', allowed: true, notice_hours: 24, fee: 'none' }, en: 'You can cancel up to 24 hours before. There is no charge.', sw: 'Unaweza kughairi hadi saa 24 kabla. Hakuna malipo.' },
    no: { r: { answer: 'no', allowed: false }, en: "We don't accept cancellations.", sw: 'Hatukubali kughairi.' } },
  booking_changes: { yes: { r: { answer: 'yes', allowed: true, notice_hours: 6 }, en: 'You can move a booking up to 6 hours before.', sw: 'Unaweza kubadilisha siku hadi saa 6 kabla.' },
    no: { r: { answer: 'no', allowed: false }, en: "We don't move bookings.", sw: 'Hatubadilishi muda wa miadi.' } },
  no_show: { yes: { r: { answer: 'wait', charge: 'none', wait_minutes: 15 }, en: 'We wait 15 minutes, then call you.', sw: 'Tunasubiri dakika 15, kisha tunakupigia.' },
    no: { r: { answer: 'no', allowed: false, charge: 'none' }, en: "We don't wait if the customer is late or not in.", sw: 'Hatusubiri mteja akichelewa au asipokuwepo.' } },
};
function deskSave(pick) {
  const rules = {}; const policy_lines = {}; const joined = [];
  for (const [t, a] of Object.entries(pick)) { const o = LINE[t][a]; rules[t] = o.r; policy_lines[t] = { en: o.en, sw: o.sw }; joined.push(o.en); }
  return { businessPolicies: { rules, policy_lines, cancellation: joined.join(' '), provenance: { cancellation: OWNER } } };
}
test('B1 bug: Cancel=No + Move=yes -> Move answers its own line, never "We don\'t accept cancellations"', () => {
  const of = OF.ownerFacts(deskSave({ cancellation: 'no', booking_changes: 'yes' }));
  assert.equal(OF.spoken(of.byTopic.get('booking_changes'), 'en'), LINE.booking_changes.yes.en);
  assert.equal(OF.spoken(of.byTopic.get('cancellation'), 'en'), "We don't accept cancellations.");
  const hit = OF.match('can I reschedule my booking?', of);
  assert.ok(hit.every((f) => !/accept cancellations/.test(f.text)), hit.map((f) => f.text).join(' | '));
});
test('B1 bug: Cancel=No + Late=yes -> Late answers its own line', () => {
  const of = OF.ownerFacts(deskSave({ cancellation: 'no', no_show: 'yes' }));
  assert.equal(OF.spoken(of.byTopic.get('no_show'), 'en'), LINE.no_show.yes.en);
  assert.equal(OF.spoken(of.byTopic.get('no_show'), 'sw'), LINE.no_show.yes.sw);
});
test('B1 bug: every Cancel/Move/Late combination (incl. unset) -> each topic reads only its own fact, en and sw', () => {
  const opts = [null, 'yes', 'no'];
  for (const c of opts) for (const m of opts) for (const l of opts) {
    const pick = {}; if (c) pick.cancellation = c; if (m) pick.booking_changes = m; if (l) pick.no_show = l;
    if (!Object.keys(pick).length) continue;
    const of = OF.ownerFacts(deskSave(pick));
    for (const [t, a] of Object.entries({ cancellation: c, booking_changes: m, no_show: l })) {
      const f = of.byTopic.get(t); const tag = `C=${c} M=${m} L=${l} ${t}`;
      if (!a) { assert.ok(!f, `${tag}: unset topic must not borrow (${f && f.text})`); continue; }
      assert.equal(OF.spoken(f, 'en'), LINE[t][a].en, tag);
      assert.equal(OF.spoken(f, 'sw'), LINE[t][a].sw, tag);
    }
  }
});
test('policy_lines: en and sw spoken word for word; empty sw -> "Timu itathibitisha."; no wording copy in Brain', () => {
  const of = OF.ownerFacts({ businessPolicies: { rules: { warranty: { answer: 'yes', none: false, months: 3 }, returns: { answer: 'custom', mode: 'custom', note: 'Ask us first.' } },
    policy_lines: { warranty: { en: 'We give a 3 months guarantee on our work.', sw: 'Tunatoa dhamana ya miezi 3 kwa kazi yetu.' }, returns: { en: 'Ask us first.', sw: '' } } } });
  assert.equal(OF.spoken(of.byTopic.get('warranty'), 'en'), 'We give a 3 months guarantee on our work.');
  assert.equal(OF.spoken(of.byTopic.get('warranty'), 'sw'), 'Tunatoa dhamana ya miezi 3 kwa kazi yetu.');
  assert.equal(OF.spoken(of.byTopic.get('returns'), 'en'), 'Ask us first.');
  assert.equal(OF.spoken(of.byTopic.get('returns'), 'sw'), 'Timu itathibitisha.');
  const src = fs.readFileSync(path.join(__dirname, '../src/conversation/v2/ownerFacts.js'), 'utf8');
  assert.ok(!/NONE_LINES/.test(src) && !/Hatukubali kughairi/.test(src), 'Brain keeps no copy of Desk wording');
  // a policy_lines line reaches the call-core answer too
  const cc = CC.answers([{ type: 'ask', ask: 'policy' }], 'do you give a guarantee?', machine(), { ...DND, businessPolicies: of && { rules: {}, policy_lines: { warranty: { en: 'We give a 3 months guarantee on our work.', sw: 'x' } } } }, 'en');
  assert.ok(cc.some((a) => /3 months guarantee/.test(a.text || '')), JSON.stringify(cc));
});
test('delivery Pickup only (mode pickup_only) is a real answer, not "no delivery info"', () => {
  const desk = OF.ownerFacts({ businessPolicies: { rules: { delivery: { answer: 'no', mode: 'pickup_only' } }, policy_lines: { delivery: { en: 'We do not deliver. Customers collect from us.', sw: 'Hatupeleki. Wateja huchukua kwetu.' } } } });
  assert.equal(desk.byTopic.get('delivery').mode, 'pickup_only');
  assert.equal(OF.spoken(desk.byTopic.get('delivery'), 'en'), 'We do not deliver. Customers collect from us.');
  assert.equal(OF.spoken(desk.byTopic.get('delivery'), 'sw'), 'Hatupeleki. Wateja huchukua kwetu.');
  const legacy = OF.ownerFacts({ businessPolicies: { rules: { delivery: { mode: 'pickup_only' } }, delivery: '' } });
  assert.match(OF.spoken(legacy.byTopic.get('delivery'), 'en'), /pickup only/i);
  assert.ok(OF.match('do you deliver?', legacy).some((f) => f.topic === 'delivery'));
});
