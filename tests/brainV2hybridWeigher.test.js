'use strict';
// Hybrid weigher v1 — pure ladder + wire fixtures w1–w8 (path H).
// Keeps R7a a–f green via tests/brainV2catalogueFollowupBind.test.js.
// Run: node --test tests/brainV2hybridWeigher.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const M = require('../src/conversation/v2/machine');
const AM = require('../src/conversation/v2/audibleMouth');
const HW = require('../src/conversation/v2/hybridWeigher');
const MS = require('../src/conversation/v2/modelShadow');

const NOW = new Date('2026-10-23T16:00:00Z');
const DD = profileFromSnapshot(TENANT);
const POST_ID = 'svc_7';
const PRICE_ID = 'svc_11';
const NO_SAY_ID = 'svc_10';

function modelOf(...calls) {
  return async () => ({ calls, text: 'MODEL PROSE NEVER SPEAK 9999 Kericho Nairobi invent' });
}

before(() => {
  process.env.BRAIN_V2_FACT_STORE = '1';
  process.env.BRAIN_V2_TOPIC_PROPOSALS = '1';
});

describe('hybridWeigher pure ladder', () => {
  it('(w1) FAQ≥0.7 + model get_price → rules_faq, no seed', () => {
    const d = HW.weighHybridTurn({
      faqScore: 0.85,
      hollow: true,
      mc: {
        calls: [{ name: 'get_price', args: { service_id: PRICE_ID } }],
        checks: [{ ok: true }],
        answeredBy: 'primary',
      },
      seedAvailable: true,
      factMissing: false,
    });
    assert.equal(d.trace, 'rules_faq');
    assert.equal(d.priority, 100);
    assert.equal(d.applyR7aSeed, false);
    assert.equal(d.rules_strength, 'FAQ_HARD');
  });

  it('(w2) TRAIN_TRUE + model null → rules_train', () => {
    const d = HW.weighHybridTurn({
      faqScore: null,
      hollow: false,
      mc: null,
      mouthFailFast: false,
      seedAvailable: false,
    });
    assert.equal(d.trace, 'rules_train');
    assert.equal(d.priority, 90);
    assert.equal(d.applyR7aSeed, false);
  });

  it('(w3) hollow + VALID_READ area Kericho in budget → seed_r7a', () => {
    const d = HW.weighHybridTurn({
      hollow: true,
      mc: {
        calls: [{ name: 'check_availability', args: { area: 'Kericho' } }],
        checks: [{ ok: true }],
        answeredBy: 'primary',
      },
      seedAvailable: true,
      mouthFailFast: false,
    });
    assert.equal(d.trace, 'seed_r7a');
    assert.equal(d.priority, 80);
    assert.equal(d.applyR7aSeed, true);
  });

  it('(w3b) Kericho coverage seedAvailable even when hollow=false', () => {
    const d = HW.weighHybridTurn({
      hollow: false,
      mc: {
        calls: [{ name: 'check_availability', args: { area: 'Kericho' } }],
        checks: [{ ok: true }],
        answeredBy: 'primary',
      },
      seedAvailable: true,
    });
    assert.equal(d.trace, 'seed_r7a');
    assert.equal(d.applyR7aSeed, true);
  });

  it('(w4) hollow + fail-fast null → rules_degrade', () => {
    const d = HW.weighHybridTurn({
      hollow: true,
      mc: null,
      mouthFailFast: true,
      seedAvailable: false,
      repairs: 0,
    });
    assert.equal(d.trace, 'rules_degrade');
    assert.equal(d.priority, 50);
    assert.equal(d.applyR7aSeed, false);
  });

  it('(w5) VALID_READ + factMissing → honest_miss (still seeds bind)', () => {
    const d = HW.weighHybridTurn({
      hollow: true,
      mc: {
        calls: [{ name: 'get_price', args: { service_id: NO_SAY_ID } }],
        checks: [{ ok: true }],
        answeredBy: 'primary',
      },
      seedAvailable: true,
      factMissing: true,
    });
    assert.equal(d.trace, 'honest_miss');
    assert.equal(d.priority, 40);
    assert.equal(d.applyR7aSeed, true);
  });

  it('(w6) repairs≥2 hollow → escalate', () => {
    const d = HW.weighHybridTurn({
      hollow: true,
      mc: null,
      mouthFailFast: true,
      repairs: 2,
      seedAvailable: false,
    });
    assert.equal(d.trace, 'escalate');
    assert.equal(d.priority, 20);
    assert.equal(d.escalate, true);
    assert.equal(d.applyR7aSeed, false);
  });

  it('(w7) TRAIN_TRUE list + model read without seedAvailable → rules_train', () => {
    const d = HW.weighHybridTurn({
      hollow: false,
      mc: {
        calls: [{ name: 'check_availability', args: { service_id: POST_ID } }],
        checks: [{ ok: true }],
        answeredBy: 'primary',
      },
      seedAvailable: false,
    });
    assert.equal(d.trace, 'rules_train');
    assert.equal(d.applyR7aSeed, false);
  });

  it('(w8) write propose_booking / create_booking → c1_skip', () => {
    for (const name of ['propose_booking', 'create_booking']) {
      const d = HW.weighHybridTurn({
        hollow: true,
        mc: {
          calls: [{ name, args: { service_id: POST_ID } }],
          checks: [{ ok: true }],
          answeredBy: 'primary',
        },
        seedAvailable: false,
      });
      assert.equal(d.trace, 'c1_skip', name);
      assert.equal(d.action, HW.ACTION.C1_SKIP, name);
      assert.equal(d.applyR7aSeed, false, name);
    }
  });

  it('agreementAgree never changes action (log-only)', () => {
    const a = HW.weighHybridTurn({
      hollow: true,
      mc: {
        calls: [{ name: 'check_availability', args: { area: 'Kericho' } }],
        checks: [{ ok: true }],
      },
      seedAvailable: true,
      agreementAgree: true,
    });
    const b = HW.weighHybridTurn({
      hollow: true,
      mc: {
        calls: [{ name: 'check_availability', args: { area: 'Kericho' } }],
        checks: [{ ok: true }],
      },
      seedAvailable: true,
      agreementAgree: false,
    });
    assert.equal(a.trace, b.trace);
    assert.equal(a.applyR7aSeed, b.applyR7aSeed);
    assert.equal(a.agreementAgree, true);
    assert.equal(b.agreementAgree, false);
  });

  it('answeredBy=none empty → ABSENT / no seed', () => {
    const d = HW.weighHybridTurn({
      hollow: true,
      mc: { calls: [], checks: [], answeredBy: 'none', timedOut: true },
      seedAvailable: false,
    });
    assert.equal(d.model_strength, 'ABSENT');
    assert.equal(d.applyR7aSeed, false);
  });
});

describe('hybridWeigher wire fixtures w1–w8', () => {
  it('(w2) bound Post-Construction explain, model null → rules_train + explain', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'After construction cleaning. Can you tell me more about it?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: null,
    });
    assert.match(t.line, /dust and debris|after building|renovation|post-construction/i);
    assert.doesNotMatch(t.line, /didn'?t catch that/i);
    const w = state.trace.find((x) => x.weigher);
    assert.ok(w, 'weigher trace');
    assert.equal(w.weigher, 'rules_train');
    assert.ok(!state.trace.some((x) => x.r7a));
  });

  it('(w3) hollow/unbound Kericho + validated area → seed_r7a coverage', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'Do you serve Kericho?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'check_availability', args: { area: 'Kericho' } }),
    });
    assert.match(t.line, /Kericho isn't on our list of service areas/i);
    assert.doesNotMatch(t.line, /MODEL PROSE|9999/);
    assert.ok(state.trace.some((x) => x.r7a && x.r7a.kind === 'coverage'));
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'seed_r7a');
  });

  it('(w4) hollow + pending past 750ms → rules_degrade + mouthFailFast', async () => {
    const state = M.createState({ lang: 'en' });
    const t0 = Date.now();
    const t = await M.runTurn(state, {
      text: 'Hmm okay then.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => {
        await new Promise((r) => setTimeout(r, 1600));
        return { calls: [], answeredBy: 'none', timedOut: true };
      },
    });
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, `expected fail-fast <1500ms, got ${ms}`);
    assert.ok(state.trace.some((x) => x.mouthFailFast));
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'rules_degrade');
    assert.ok(t.line);
    assert.doesNotMatch(t.line, /MODEL PROSE|9999/);
  });

  it('(w5) ok get_price no say → honest_miss quote path, zero invent', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'How much for that?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'get_price', args: { service_id: NO_SAY_ID } }),
    });
    assert.doesNotMatch(t.line, /\b9999\b|MODEL PROSE|bob/i);
    assert.match(t.line, /quote|don'?t have (a |the )?price|team|call you|confirm|Large Commercial/i);
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'honest_miss');
  });

  it('(w6) repairs≥2 hollow → escalate handoff path', async () => {
    const state = M.createState({ lang: 'en' });
    state.repairs = 2;
    const t = await M.runTurn(state, {
      text: 'Blargle fizzbuzz quux.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => ({ calls: [], answeredBy: 'none', timedOut: true }),
    });
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'escalate');
    assert.match(t.line, /call you|team|someone|manager|owner|callback|get back/i);
    assert.ok(state.phase === 'readback' || /call you|callback|team/i.test(t.line));
    assert.doesNotMatch(t.line, /MODEL PROSE|9999/);
  });

  it('(w7) TRAIN_TRUE list + model read → rules unchanged (no r7a)', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'What services do you offer?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'check_availability', args: { service_id: POST_ID } }),
    });
    assert.match(t.line, /mattress|sofa|deep cleaning|Which would you like|house cleaning/i);
    assert.doesNotMatch(t.line, /dust and debris/i);
    assert.ok(!state.trace.some((x) => x.r7a));
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'rules_train');
  });

  it('(w8) write create_booking → c1_skip, no mouth override / no invent', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'zzzz qqqq.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'create_booking', args: { service_id: POST_ID } }),
    });
    assert.doesNotMatch(t.line, /MODEL PROSE|9999|dust and debris/i);
    assert.ok(!state.trace.some((x) => x.r7a), 'writes must not R7a-seed mouth');
    const w = state.trace.find((x) => x.weigher);
    assert.equal(w.weigher, 'c1_skip');
  });

  it('speakSafeLine still drops model plaintext', () => {
    assert.equal(AM.speakSafeLine('Train line only.', 'MODEL PROSE 9999'), 'Train line only.');
  });

  it('HARD_CAP stays 1800; fail-fast 750', () => {
    assert.equal(MS.HARD_CAP_MS, 1800);
    assert.ok(M.MOUTH_FAILFAST_MS >= 700 && M.MOUTH_FAILFAST_MS <= 800);
  });
});
