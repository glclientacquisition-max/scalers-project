// BRAIN_CONFIRMED_COVERAGE (Phase 0 of the escalation system).
// Replays HD_23445a4f780c (staging D&D, seed coverage list spoken as fact,
// "Okay." taken as a yes to the note offer).
// Run: node --test tests/confirmedCoverage.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const cc = require('../src/conversation/confirmedCoverage');
const {
  assessCoverage,
  coverageStatus,
  coverageAskSpeech,
  decideVisitPlace,
  visitBlockSpeech,
} = require('../src/conversation/visitLocation');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const brain = require('../src/conversation/brainState');
const { ackIsConsent, noteSpokenPendingAsk } = require('../src/conversation/callCorrectives');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { factPolicyMap } = require('../src/conversation/provenance');
const { completeTurnReason } = require('../src/conversation/unfinishedTurn');
const { coverageNextStepFor } = require('../src/conversation/coverageNextStep');
const { executeBrainTools } = require('../src/conversation/toolExecution');
const { hashFactValue, factValueForPath, tenantRowFromProfile } = require('../src/conversation/factHash');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'voice-calls', 'HD_23445a4f780c.coverage.json'), 'utf8')
);

/** D&D staging as it was: seed list, tenant_field_meta row source=seed. */
const SEED = {
  businessName: FIXTURE.businessName,
  vertical: FIXTURE.vertical,
  businessPolicies: FIXTURE.businessPolicies,
  servicesCatalog: [{ name: 'Deep Cleaning', price_range: 'KES 3,000 - 6,000' }],
  fieldMeta: { loaded: true, byPath: { 'policies.coverage_areas': { source: 'seed', confirmed_at: null } } },
};
/** Same list with no meta row at all (P0 would read it as owner). */
const NO_ROW = { ...SEED, fieldMeta: null };

function ownerMeta(profile, { hash = false } = {}) {
  const row = { source: 'owner', confirmed_at: '2026-10-01T09:00:00Z' };
  if (hash) row.value_hash = hashFactValue(factValueForPath('policies.coverage_areas', tenantRowFromProfile(profile)));
  return { loaded: true, byPath: { 'policies.coverage_areas': row } };
}
const CONFIRMED = { ...SEED, fieldMeta: ownerMeta(SEED) };

const saved = {};
function setEnv(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
}
function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
}

function guard(spoken, caller, language, profile = SEED, state = {}) {
  return polishSpokenDetail(spoken, {
    profile,
    callerTurns: [caller],
    language,
    state,
    toolResults: [],
    capabilities: {},
  }).text;
}

const CLAIM = /\b(?:we (?:\w+ ){0,2}(?:cover|serve)|tunafika|outside our coverage|surrounding areas|nje ya huduma)\b/i;

describe('flag parsing', () => {
  afterEach(restoreEnv);
  it('on only when exactly "on"', () => {
    for (const v of ['ON', 'true', '1', ' on', 'yes', '']) {
      setEnv({ BRAIN_CONFIRMED_COVERAGE: v });
      assert.equal(cc.confirmedCoverageEnabled(), false, JSON.stringify(v));
    }
    setEnv({ BRAIN_CONFIRMED_COVERAGE: 'on' });
    assert.equal(cc.confirmedCoverageEnabled(), true);
    setEnv({ BRAIN_CONFIRMED_COVERAGE: null });
    assert.equal(cc.confirmedCoverageEnabled(), false);
  });
});

describe('flag off: today\'s behaviour is unchanged', () => {
  beforeEach(() => setEnv({ BRAIN_CONFIRMED_COVERAGE: null, FACT_HASH_MODE: null }));
  afterEach(restoreEnv);
  it('seed list still answers coverage', () => {
    assert.equal(assessCoverage('Syokimau', SEED), 'inside');
    assert.equal(coverageStatus('Nakuru', SEED), 'outside');
    assert.match(coverageAskSpeech('Do you cover Syokimau?', SEED, 'en'), /^Yes, we cover Syokimau\./);
  });
  it('model coverage claims are spoken as before (t9, t11)', () => {
    const [, t9, t11] = FIXTURE.turns;
    assert.equal(guard(t9.spoken, t9.caller, 'sw'), 'Ndiyo, tunafika Syokimau.');
    assert.match(guard(t11.spoken, t11.caller, 'en'), /outside our coverage area, as we only serve Nairobi/);
  });
  it('bare Okay after the note offer is still consent', () => {
    assert.equal(ackIsConsent(['offer'], 'Okay.'), true);
    assert.equal(ackIsConsent(['offer'], 'Sawa'), true);
  });
  it('prompt carries the seed Coverage line, no needs on state', () => {
    const prompt = buildLiveGroundTruth(SEED);
    assert.match(prompt, /- Coverage: Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, Syokimau/);
    const state = brain.observeCallerTurn(brain.createBrainState(SEED), { text: 'Do you cover Syokimau?', profile: SEED });
    assert.equal(state.needs, undefined);
  });
});

describe('flag on, seed list (HD_23445a4f780c)', () => {
  beforeEach(() => setEnv({ BRAIN_CONFIRMED_COVERAGE: 'on', FACT_HASH_MODE: null }));
  afterEach(restoreEnv);

  it('no place is inside or outside', () => {
    assert.equal(coverageStatus('Syokimau', SEED), 'unconfirmed');
    assert.equal(coverageStatus('Nakuru', SEED), 'unconfirmed');
    assert.equal(assessCoverage('Syokimau', SEED), 'unknown');
    assert.equal(assessCoverage('Nakuru', SEED), 'unknown');
    assert.equal(coverageStatus('near the big church', SEED), 'unknown');
  });

  it('coverage ask: "I\'ll have the team confirm {place}" plus the next step, en / sw / sheng', () => {
    assert.equal(
      coverageAskSpeech('Do you cover Syokimau?', SEED, 'en'),
      "I'll have the team confirm Syokimau. Which service would you like?"
    );
    assert.equal(
      coverageAskSpeech('Mnafika Syokimau?', SEED, 'sw'),
      'Nitaiomba timu yetu ithibitishe eneo la Syokimau. Ungependa huduma gani?'
    );
    assert.match(coverageAskSpeech('Mnafika Nakuru?', SEED, 'sheng'), /^Nitaambia team ithibitishe Nakuru\./);
    for (const line of [coverageAskSpeech('Do you cover Nakuru?', SEED, 'en'), coverageAskSpeech('What about Syokimau?', SEED, 'en')]) {
      assert.doesNotMatch(line, CLAIM);
      assert.doesNotMatch(line, /\b(?:call you|tomorrow|today|within|hours?)\b/i, 'no callback-time promise');
    }
  });

  it('replay t8: the model coverage list is replaced by the team-confirm line', () => {
    const t8 = FIXTURE.turns[0];
    const out = guard(t8.spoken, t8.caller, 'en');
    assert.doesNotMatch(out, CLAIM);
    assert.doesNotMatch(out, /Syokimau|Kitengela|Juja/);
    assert.match(out, /I'll have the team confirm/);
    assert.match(out, /Where are you located/);
  });

  it('replay t9: "Ndiyo, tunafika Syokimau" and the Kiswahili list are not spoken', () => {
    const t9 = FIXTURE.turns[1];
    for (const spoken of [t9.spoken, t9.model]) {
      const out = guard(spoken, t9.caller, 'sw');
      assert.doesNotMatch(out, CLAIM, out);
      assert.match(out, /ithibitishe/);
    }
  });

  it('replay t11: no "outside our coverage", no seed list, one team-confirm line', () => {
    const t11 = FIXTURE.turns[2];
    const out = guard(t11.spoken, t11.caller, 'en');
    assert.doesNotMatch(out, CLAIM);
    assert.equal(out.match(/I'll have the team confirm/g).length, 1);
    assert.equal(coverageNextStepFor(out, { profile: SEED, language: 'en', state: {} }), 'Which service would you like?');
  });

  it('streamed sentences add the team-confirm line once per turn', () => {
    const state = { conversation: { turnCount: 4 } };
    const first = guard('We cover Nairobi.', 'Do you cover Juja?', 'en', SEED, state);
    const second = guard('We also serve Juja.', 'Do you cover Juja?', 'en', SEED, state);
    assert.equal(first, "I'll have the team confirm Juja.");
    assert.doesNotMatch(second, /team confirm/);
  });

  it('the coverage ask records one open need, and the call summary carries it', () => {
    let state = brain.createBrainState(SEED);
    state = brain.observeCallerTurn(state, { text: 'Do you cover Syokimau?', profile: SEED });
    state = brain.observeCallerTurn(state, { text: 'Do you cover Syokimau?', profile: SEED });
    assert.equal(state.needs.length, 1);
    assert.deepEqual(
      { kind: state.needs[0].kind, place: state.needs[0].place, status: state.needs[0].status, open_reason: state.needs[0].open_reason },
      { kind: 'coverage_confirm', place: 'Syokimau', status: 'open', open_reason: 'coverage_unconfirmed' }
    );
    assert.ok(deriveCallSummary({ brainState: state }).instructions.includes('Confirm coverage: Syokimau'));
    assert.equal(completeTurnReason('Do you cover Syokimau?', { profile: SEED, state }), 'coverage_ask');
  });

  it('visit in an unconfirmed area is saved with "area not confirmed", never refused as outside', () => {
    const area = decideVisitPlace('Syokimau', { profile: SEED, detailAsked: true });
    assert.equal(area.bookable, true);
    assert.equal(area.blocked, '');
    assert.equal(area.areaUnconfirmed, true);
    assert.equal(area.confirmAccess, false);
    const far = decideVisitPlace('Nakuru', { profile: SEED, detailAsked: true });
    assert.notEqual(far.blocked, 'outside');
    assert.equal(visitBlockSpeech('unknown_coverage', 'en', 'Syokimau'), "I'll have the team confirm Syokimau.");
  });

  it('create_appointment in an unconfirmed area notes it and is not blocked', async () => {
    const out = await executeBrainTools({
      parsed: {
        appointment: { serviceName: 'Deep Cleaning', name: 'Alvin', whenText: 'kesho 10am', landmark: 'Nakuru, Milimani estate gate 2' },
      },
      capabilities: { createAppointment: true },
      businessPolicies: SEED.businessPolicies,
      fieldMeta: SEED.fieldMeta,
      handlers: { createAppointment: async (value) => ({ id: 'a1', ...value }) },
      now: new Date('2026-10-09T08:00:00Z'),
    });
    const row = out.results.find((r) => r.action === 'create_appointment');
    assert.equal(row.status, 'succeeded');
    assert.match(row.value.notes, /area not confirmed, check coverage/);
  });

  it('prompt drops the unconfirmed list and says the team confirms', () => {
    const prompt = buildLiveGroundTruth(SEED);
    assert.doesNotMatch(prompt, /- Coverage: Nairobi/);
    assert.match(prompt, /- Coverage: \(not confirmed by the owner\)/);
    assert.match(prompt, /I'll have the team confirm \{place\}/);
    assert.ok(factPolicyMap(SEED.businessPolicies, SEED.fieldMeta).unknown.includes('Areas we serve'));
  });

  it('no meta row is not owner-confirmed coverage either', () => {
    assert.equal(coverageStatus('Syokimau', NO_ROW), 'unconfirmed');
    assert.match(coverageAskSpeech('Do you cover Syokimau?', NO_ROW, 'en'), /^I'll have the team confirm Syokimau\./);
    assert.doesNotMatch(buildLiveGroundTruth(NO_ROW), /- Coverage: Nairobi/);
  });
});

describe('flag on, owner-confirmed list', () => {
  afterEach(restoreEnv);

  it('confirmed list answers inside and outside', () => {
    setEnv({ BRAIN_CONFIRMED_COVERAGE: 'on', FACT_HASH_MODE: null });
    assert.equal(coverageStatus('Syokimau', CONFIRMED), 'inside');
    assert.equal(coverageStatus('Nakuru', CONFIRMED), 'outside');
    assert.match(coverageAskSpeech('Do you cover Syokimau?', CONFIRMED, 'en'), /^Yes, we cover Syokimau\./);
    assert.match(coverageAskSpeech('Do you cover Nakuru?', CONFIRMED, 'en'), /outside our coverage/);
    assert.match(buildLiveGroundTruth(CONFIRMED), /- Coverage: Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, Syokimau/);
    assert.equal(guard('Yes, we cover Syokimau.', 'Do you cover Syokimau?', 'en', CONFIRMED), 'Yes, we cover Syokimau.');
    assert.doesNotMatch(guard('We do not cover Syokimau.', 'Do you cover Syokimau?', 'en', CONFIRMED), /do not cover/);
    assert.doesNotMatch(guard('We do not cover Syokimau.', 'Do you cover Syokimau?', 'en', CONFIRMED), /team confirm/);
  });

  it('FACT_HASH_MODE on: an owner row without a matching value_hash is unconfirmed', () => {
    setEnv({ BRAIN_CONFIRMED_COVERAGE: 'on', FACT_HASH_MODE: 'on' });
    assert.equal(coverageStatus('Syokimau', CONFIRMED), 'unconfirmed');
    const hashed = { ...SEED, fieldMeta: ownerMeta(SEED, { hash: true }) };
    assert.equal(coverageStatus('Syokimau', hashed), 'inside');
    const edited = {
      ...hashed,
      businessPolicies: { coverage_areas: [...SEED.businessPolicies.coverage_areas, 'place:thika'] },
    };
    assert.equal(coverageStatus('Syokimau', edited), 'unconfirmed');
  });
});

describe('note-offer consent needs an explicit yes (flag on)', () => {
  beforeEach(() => setEnv({ BRAIN_CONFIRMED_COVERAGE: 'on' }));
  afterEach(restoreEnv);

  it('bare acknowledgements are not consent', () => {
    for (const text of ['Okay.', 'Sawa', 'OK', 'ok', 'Poa', 'Eeh', 'Okay okay', 'Sawa sawa', 'Okay, leave it', 'No', 'Hapana', 'Okay no']) {
      assert.equal(ackIsConsent(['offer'], text), false, text);
    }
  });
  it('explicit yes is consent', () => {
    for (const text of ['Yes', 'Yes please', 'Yeah', 'Ndio', 'Ndiyo', 'Sure', 'Please do', 'Okay, sure', 'Sawa, ndio', 'Go ahead', 'Ndio tafadhali']) {
      assert.equal(ackIsConsent(['offer'], text), true, text);
    }
  });
  it('a confirm ask keeps its own rule', () => {
    assert.equal(ackIsConsent(['confirm'], 'Okay'), true);
  });

  it('replay t11-t13: "Okay." after the offer saves nothing and re-asks yes or no', () => {
    let state = brain.createBrainState(SEED);
    state = brain.observeCallerTurn(state, { text: FIXTURE.turns[2].caller, profile: SEED });
    noteSpokenPendingAsk(state, FIXTURE.turns[2].appended);
    assert.equal(state.conversation.pendingAsk?.kind, 'offer');
    state = brain.observeCallerTurn(state, { text: 'Okay.', profile: SEED });
    assert.equal(state.conversation.consentAck, false);
    const parsed = ensureRequiredCreateRequest({}, state, { createServiceRequest: true });
    assert.equal(parsed.serviceRequest, undefined);
    const local = resolveLocalReply({ text: 'Okay.', state, profile: SEED, language: 'en' });
    assert.equal(local?.outcome, 'offer_yes_no');
    assert.equal(local.line, 'Should I note it for the team? Please say yes or no.');
    noteSpokenPendingAsk(state, local.line);
    state = brain.observeCallerTurn(state, { text: 'Yes please.', profile: SEED });
    assert.equal(state.conversation.consentAck, true);
    const yes = ensureRequiredCreateRequest({}, state, { createServiceRequest: true });
    assert.equal(yes.serviceRequest?.type, 'callback');
  });

  it('flag off: the same "Okay." still saves (documents the bug the flag fixes)', () => {
    setEnv({ BRAIN_CONFIRMED_COVERAGE: null });
    let state = brain.createBrainState(SEED);
    state = brain.observeCallerTurn(state, { text: FIXTURE.turns[2].caller, profile: SEED });
    noteSpokenPendingAsk(state, FIXTURE.turns[2].appended);
    state = brain.observeCallerTurn(state, { text: 'Okay.', profile: SEED });
    assert.equal(state.conversation.consentAck, true);
  });
});
