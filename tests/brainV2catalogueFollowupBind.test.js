'use strict';
// R7a — propose → validate → infoAnswer (contract fixtures a–f)
// + GO C: mouth fail-fast + Train after-building bind (no serviceAliases.js).
// Run: node --test tests/brainV2catalogueFollowupBind.test.js
// Or: npm run test:brain (includes this file)

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const N = require('../src/conversation/v2/nlu');
const M = require('../src/conversation/v2/machine');
const AM = require('../src/conversation/v2/audibleMouth');
const FS = require('../src/knowledge/factStore');
const { buildCatalogue, validateCall } = require('../src/conversation/v2/catalogue');

const NOW = new Date('2026-10-23T16:00:00Z');
const DD = profileFromSnapshot(TENANT);
const POST_ID = 'svc_7'; // Post-Construction Clean (fact-store index)
const PRICE_ID = 'svc_11'; // Sofa Cleaning — has price.say
const NO_SAY_ID = 'svc_10'; // Large Commercial Contract — mode=ask, say=null

function modelOf(...calls) {
  return async () => ({ calls, text: 'MODEL PROSE NEVER SPEAK 9999 Kericho Nairobi invent' });
}

before(() => {
  process.env.BRAIN_V2_FACT_STORE = '1';
  process.env.BRAIN_V2_TOPIC_PROPOSALS = '1';
});

describe('R7a catalogue: fact ids + area accepted', () => {
  it('validateCall accepts check_availability service_id from facts', () => {
    const cat = buildCatalogue({ profile: DD });
    assert.ok(cat.check_availability.parameters.properties.area);
    const v = validateCall(cat, { name: 'check_availability', args: { service_id: POST_ID } });
    assert.equal(v.ok, true, JSON.stringify(v));
  });
  it('validateCall accepts check_availability area Kericho', () => {
    const cat = buildCatalogue({ profile: DD });
    const v = validateCall(cat, { name: 'check_availability', args: { area: 'Kericho' } });
    assert.equal(v.ok, true, JSON.stringify(v));
  });
});

describe('R7a seed helpers (no Gemini)', () => {
  it('lookup_file seed still true for last_visit', () => {
    const mc = {
      calls: [{ name: 'lookup_file', args: { topic: 'last_visit' } }],
      checks: [{ ok: true }],
    };
    assert.equal(AM.lookupFileSeedsRecall(mc), true);
  });
  it('invalid / unknown_service does not seed', () => {
    const mc = {
      calls: [{ name: 'check_availability', args: { service_id: 'svc_nope' } }],
      checks: [{ ok: false, code: 'unknown_service' }],
    };
    assert.equal(AM.validatedReadSeeds(mc, { profile: DD, u: { text: 'x', intents: [], followup: true } }), null);
  });
  it('answeredBy=none with empty calls does not seed', () => {
    const mc = { calls: [], checks: [], answeredBy: 'none', timedOut: true };
    assert.equal(AM.validatedReadProposal(mc), null);
    assert.equal(AM.validatedReadSeeds(mc, { profile: DD, u: { text: 'x', intents: [], followup: true } }), null);
  });
});

describe('R7a fixtures a–f (contract §7)', () => {
  it('(a) check_availability post-construction + rules would which-one → explain', async () => {
    const state = M.createState({ lang: 'en' });
    const t1 = await M.runTurn(state, { text: 'What services do you offer?', profile: DD, lang: 'en', now: NOW });
    assert.match(t1.line, /after building work|Which would you like/i);

    // Train spoken_labels bind Post-Construction; model seed still works when hollow.
    const uBare = N.understand('Tell me more about after building work.', { profile: DD, now: NOW, topic: 'services' });
    assert.ok(uBare.service && /post-?construction/i.test(uBare.service.name), 'Train labels bind after-building');

    const t2 = await M.runTurn(state, {
      text: 'Tell me more about after building work.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'check_availability', args: { service_id: POST_ID } }),
    });
    assert.doesNotMatch(t2.line, /didn'?t catch that/i);
    assert.doesNotMatch(t2.line, /Which would you like/i);
    assert.match(t2.line, /after building|renovation|dust and debris|post-construction/i);
    assert.doesNotMatch(t2.line, /9999|MODEL PROSE|invent/i);
  });

  it('(b) check_availability area Kericho unlisted → out-of-area honesty', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'Do you serve Kericho?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'check_availability', args: { area: 'Kericho' } }),
    });
    assert.match(t.line, /Kericho isn't on our list of service areas/i);
    assert.match(t.line, /call you back/i);
    assert.doesNotMatch(t.line, /Which would you like/i);
    assert.doesNotMatch(t.line, /MODEL PROSE|9999/);
    assert.ok(state.trace.some((x) => x.r7a && x.r7a.kind === 'coverage'));
  });

  it('(c) get_price with say → typed say only', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'How much for that?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'get_price', args: { service_id: PRICE_ID } }),
    });
    assert.match(t.line, /800|eight hundred/i);
    assert.match(t.line, /seat|Sofa/i);
    assert.doesNotMatch(t.line, /9999|MODEL PROSE|Westlands|bob/i);
  });

  it('(d) get_price no say → quote honesty, zero invented KES', async () => {
    const state = M.createState({ lang: 'en' });
    const t = await M.runTurn(state, {
      text: 'How much is the large commercial?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: modelOf({ name: 'get_price', args: { service_id: NO_SAY_ID } }),
    });
    assert.doesNotMatch(t.line, /\b9999\b/);
    assert.doesNotMatch(t.line, /MODEL PROSE/);
    const invent = /KSh\s*9999|KES\s*9999|bob/i.test(t.line);
    assert.equal(invent, false);
    assert.match(t.line, /quote|don'?t have (a |the )?price|team|call you|confirm/i);
  });

  it('(e) timeout / unknown_service / answeredBy=none → rules unchanged when unbound', async () => {
    const state = M.createState({ lang: 'en' });
    // Fresh turn, no services topic — unbound nonsense + invalid id → no seed, no explain
    const bad = await M.runTurn(state, {
      text: 'Blargle fizzbuzz quux.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => ({
        calls: [{ name: 'check_availability', args: { service_id: 'svc_not_real' } }],
        text: '',
        answeredBy: 'none',
      }),
    });
    assert.doesNotMatch(bad.line, /dust and debris/i);
    assert.ok(
      /didn'?t catch|Which would you like|Ungependa|Sorry|help|service/i.test(bad.line),
      `expected rules hollow/list, got: ${bad.line}`
    );
    assert.ok(!state.trace.some((x) => x.r7a));
  });

  it('(f) rules already Train-true list + model proposes read → rules unchanged', async () => {
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
    assert.ok(!state.trace.some((x) => x.r7a), 'no r7a override on Train-true list');
  });
});

describe('Train Post-Construction bind (no serviceAliases.js)', () => {
  it('spokenLabelsForService compiles after-building / baada ya ujenzi', () => {
    const labels = FS.spokenLabelsForService('Post-Construction Clean', {});
    assert.ok(labels.some((l) => /after construction/i.test(l)));
    assert.ok(labels.some((l) => /after building/i.test(l)));
    assert.ok(labels.some((l) => /baada ya ujenzi/i.test(l)));
  });

  it('after construction / after building / baada ya ujenzi bind → Post-Construction', () => {
    for (const t of [
      'After construction cleaning. Can you tell me more about it?',
      'Tell me more about after building work.',
      'baada ya ujenzi',
      'after building',
    ]) {
      const u = N.understand(t, { profile: DD, now: NOW, topic: 'services' });
      assert.ok(u.service && /post-?construction/i.test(u.service.name), `bind miss for: ${t}`);
    }
  });

  it('serviceAliases.js stays deleted; nlu has no aliasService', () => {
    assert.equal(typeof N.aliasService, 'undefined');
    assert.equal(fs.existsSync(path.join(__dirname, '../src/conversation/v2/serviceAliases.js')), false);
  });

  it('after-construction STT → explain even with null/slow model (Train bind)', async () => {
    const state = M.createState({ lang: 'en' });
    // No prior services list — Train bind alone must reach receipts.explain without C7.
    const t0 = Date.now();
    const t = await M.runTurn(state, {
      text: 'After construction cleaning. Can you tell me more about it?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => {
        await new Promise((r) => setTimeout(r, 1600));
        return { calls: [], answeredBy: 'none', timedOut: true };
      },
    });
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, `expected fail-fast mouth <1500ms, got ${ms}`);
    assert.match(t.line, /dust and debris|after building|renovation|post-construction/i);
    assert.doesNotMatch(t.line, /didn'?t catch that/i);
    assert.doesNotMatch(t.line, /Would you like to know about prices/i);
    // Either mouthFailFast (consult raced) or topic/rules short-circuit — both OK if explain fires fast.
    assert.ok(
      state.trace.some((x) => x.mouthFailFast) || ms < 200,
      'expected fail-fast trace or topic/rules fast path'
    );
  });
});

describe('Mouth fail-fast (~750ms)', () => {
  it('MOUTH_FAILFAST_MS is ~700–800 and HARD_CAP is not raised via this export', () => {
    assert.ok(M.MOUTH_FAILFAST_MS >= 700 && M.MOUTH_FAILFAST_MS <= 800);
    const MS = require('../src/conversation/v2/modelShadow');
    assert.equal(MS.HARD_CAP_MS, 1800);
  });

  it('fail-fast: mouth proceeds without waiting full 1800ms dual death', async () => {
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
    assert.ok(t.line); // some rules line — not dead air
  });

  it('fast validated proposal within budget still seeds R7a', async () => {
    const state = M.createState({ lang: 'en' });
    // Unbound Kericho needs model seed (area not in Train list as place bind for "Do you serve")
    const t = await M.runTurn(state, {
      text: 'Do you serve Kericho?',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { calls: [{ name: 'check_availability', args: { area: 'Kericho' } }], text: '' };
      },
    });
    assert.match(t.line, /Kericho isn't on our list/i);
    assert.ok(state.trace.some((x) => x.r7a && x.r7a.kind === 'coverage'));
    assert.ok(!state.trace.some((x) => x.mouthFailFast));
  });
});
