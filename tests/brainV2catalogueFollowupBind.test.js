'use strict';
// R7a — propose → validate → infoAnswer (contract fixtures a–f).
// S1 / #908 phrase-bind removed; after-building explain lands via validated
// check_availability seed, not serviceAliases.
// Run: node --test tests/brainV2catalogueFollowupBind.test.js
// Or: npm run test:brain (includes this file)

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const N = require('../src/conversation/v2/nlu');
const M = require('../src/conversation/v2/machine');
const AM = require('../src/conversation/v2/audibleMouth');
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
});

describe('R7a fixtures a–f (contract §7)', () => {
  it('(a) check_availability post-construction + rules would which-one → explain', async () => {
    const state = M.createState({ lang: 'en' });
    const t1 = await M.runTurn(state, { text: 'What services do you offer?', profile: DD, lang: 'en', now: NOW });
    assert.match(t1.line, /after building work|Which would you like/i);

    // Without S1 aliases, NLU does not bind after-building — model proposes the id.
    const uBare = N.understand('Tell me more about after building work.', { profile: DD, now: NOW, topic: 'services' });
    assert.equal(uBare.service, null, 'S1 gone: no alias bind');
    assert.equal(AM.rulesMouthWouldHollow(uBare), true);

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
    assert.ok(state.trace.some((x) => x.r7a && x.r7a.kind === 'explain'), 'r7a explain traced');
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
    // never speak hallucinated served cities from model prose
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
    // Honest quote / no typed price — never invent a KES figure from model prose
    assert.doesNotMatch(t.line, /\b9999\b/);
    assert.doesNotMatch(t.line, /MODEL PROSE/);
    // Either quote offer or found:false style — must not invent a concrete KES for commercial
    const invent = /KSh\s*9999|KES\s*9999|bob/i.test(t.line);
    assert.equal(invent, false);
    // Prefer quote/callback honesty when say is null
    assert.match(t.line, /quote|don'?t have (a |the )?price|team|call you|confirm/i);
  });

  it('(e) timeout / unknown_service / answeredBy=none → rules unchanged', async () => {
    const state = M.createState({ lang: 'en' });
    await M.runTurn(state, { text: 'What services do you offer?', profile: DD, lang: 'en', now: NOW });

    // Invalid id → checks.ok false → no seed → same hollow which-one as rules-only
    const bad = await M.runTurn(state, {
      text: 'Tell me more about after building work.',
      profile: DD,
      lang: 'en',
      now: NOW,
      model: async () => ({
        calls: [{ name: 'check_availability', args: { service_id: 'svc_not_real' } }],
        text: '',
        answeredBy: 'none',
      }),
    });
    // Without valid seed, rules path: repair / which-one / service_detail — NOT explain dust line
    assert.doesNotMatch(bad.line, /dust and debris/i);
    assert.ok(
      /didn'?t catch|Which would you like|Ungependa|service_detail|deep cleaning|mattress/i.test(bad.line)
      || /Sorry/i.test(bad.line),
      `expected rules hollow/list, got: ${bad.line}`
    );
    assert.ok(!state.trace.some((x) => x.r7a && x.turn === state.turn));
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
    // Catalogue categories / which-one — NOT overridden into a single explain
    assert.match(t.line, /mattress|sofa|deep cleaning|Which would you like|house cleaning/i);
    assert.doesNotMatch(t.line, /dust and debris/i);
    assert.ok(!state.trace.some((x) => x.r7a), 'no r7a override on Train-true list');
  });
});

describe('R7a S1 removed', () => {
  it('nlu no longer exports aliasService; after-building does not bind without model', () => {
    assert.equal(typeof N.aliasService, 'undefined');
    const u = N.understand('Tell me more about after building work.', { profile: DD, now: NOW, topic: 'services' });
    assert.equal(u.service, null);
  });
});
