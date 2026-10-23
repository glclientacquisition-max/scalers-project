'use strict';
// Brain S1 — catalogue follow-up bind (HD_588103 / HD_0be4 T3 shape).
// After a services list, "Tell me more about after building work" / baada ya
// ujenzi must bind Post-Construction and reach explain — never repair +
// "Which would you like?".
// Run: node --test tests/brainV2catalogueFollowupBind.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const N = require('../src/conversation/v2/nlu');
const M = require('../src/conversation/v2/machine');
const SC = require('../src/knowledge/spokenCatalogue');
const P = require('../src/conversation/v2/proposals');

const NOW = new Date('2026-10-23T16:00:00Z');
const DD = profileFromSnapshot(TENANT);

const AFTER_BUILD_PHRASES = [
  'Tell me more about after building work.',
  'Tell me more about after building.',
  'Nieleze zaidi kuhusu baada ya ujenzi.',
  'baada ya ujenzi',
  'after building work',
  'what exactly is after building',
];

const FAMILY_PHRASES = [
  ['tell me more about move-in', /Move-In|Move-Out/i],
  ['tell me more about deep cleaning', /Deep Cleaning/i],
];

describe('S1 catalogue follow-up bind (NLU)', () => {
  for (const flag of ['1', '0']) {
    describe(`BRAIN_V2_FACT_STORE=${flag}`, () => {
      before(() => { process.env.BRAIN_V2_FACT_STORE = flag; });

      for (const t of AFTER_BUILD_PHRASES) {
        it(`binds Post-Construction for: ${JSON.stringify(t)}`, () => {
          const u = N.understand(t, { profile: DD, now: NOW, topic: 'services' });
          assert.ok(u.service, `expected service for ${t}`);
          assert.match(u.service.name, /Post-?Construction/i);
          // explain intent, or bare name that machine offers
          const okIntent = u.intents.includes('explain') || u.intents.includes('services') || u.intents.length === 0;
          assert.ok(okIntent, `unexpected intents ${u.intents} for ${t}`);
          assert.notEqual(u.reason, 'no_service_id');
        });
      }

      for (const [t, re] of FAMILY_PHRASES) {
        it(`still binds family for: ${JSON.stringify(t)}`, () => {
          const u = N.understand(t, { profile: DD, now: NOW, topic: 'services' });
          assert.ok(u.service, t);
          assert.match(u.service.name, re);
          assert.ok(u.intents.includes('explain'));
        });
      }
    });
  }
});

describe('S1 deep-clean alias does not steal appliance rows', () => {
  it('oven/fridge deep clean stays on the appliance row', () => {
    process.env.BRAIN_V2_FACT_STORE = '1';
    for (const t of ['How much is an oven deep clean?', 'fridge deep clean']) {
      const u = N.understand(t, { profile: DD, now: NOW, topic: null });
      assert.ok(u.service, t);
      assert.match(u.service.name, /Oven|Refrigerator|Fridge/i, t);
      assert.doesNotMatch(u.service.name, /Package/i, t);
    }
  });
});

describe('S1 catalogue follow-up bind (mouth)', () => {
  before(() => {
    process.env.BRAIN_V2_FACT_STORE = '1';
    process.env.BRAIN_V2_TOPIC_PROPOSALS = '1';
  });

  it('HD_588103 / HD_0be4 T3: after-building explain, not repair+which-one', async () => {
    const state = M.createState({ lang: 'en' });
    const t1 = await M.runTurn(state, { text: 'What services do you offer?', profile: DD, lang: 'en', now: NOW });
    assert.match(t1.line, /after building work/i);
    assert.match(t1.line, /Which would you like/i);

    const t2 = await M.runTurn(state, {
      text: 'Tell me more about after building work.',
      profile: DD,
      lang: 'en',
      now: NOW,
    });
    assert.doesNotMatch(t2.line, /didn'?t catch that/i);
    assert.doesNotMatch(t2.line, /Which would you like/i);
    assert.doesNotMatch(t2.line, /Ungependa ipi/i);
    // explain template for post-construction
    assert.match(t2.line, /after building|renovation|dust and debris|post-construction/i);
  });

  it('SW: baada ya ujenzi follow-up reaches explain', async () => {
    const state = M.createState({ lang: 'sw' });
    await M.runTurn(state, { text: 'Huduma gani mnafanya?', profile: DD, lang: 'sw', now: NOW });
    const t2 = await M.runTurn(state, {
      text: 'Nieleze zaidi kuhusu baada ya ujenzi.',
      profile: DD,
      lang: 'sw',
      now: NOW,
    });
    assert.doesNotMatch(t2.line, /Samahani, sijakusikia|Ungependa ipi|didn'?t catch/i);
    assert.match(t2.line, /ujenzi|ukarabati|vumbi|baada/i);
  });

  it('proposals.followUp / findEntry binds after-building', () => {
    const doc = SC.resolveSpokenCatalogue(DD);
    const e = SC.findEntry('Tell me more about after building work.', doc);
    assert.ok(e, 'findEntry');
    assert.match(e.raw.name, /Post-?Construction/i);
    const f = P.followUp({
      text: 'Tell me more about after building work.',
      doc,
      lang: 'en',
      profile: DD,
      state: {},
      topicIds: [],
    });
    assert.ok(f, 'followUp');
    assert.equal(f.kind, 'explain');
    assert.doesNotMatch(f.text, /didn'?t catch|Which would you like/i);
  });
});
