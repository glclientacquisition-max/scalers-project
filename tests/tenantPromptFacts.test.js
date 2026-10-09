// The live Gemini prompt carries every tenant fact the voice path may speak.
// HD_48e5ce069c12: coverage_areas was dropped, so Gemini said Kitengela was
// outside while the mouth says it is covered.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../src/prompts');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { factPolicyMap } = require('../src/conversation/provenance');
const {
  profileFromSnapshot,
  checkPromptFacts,
} = require('../src/conversation/promptFacts');
const SNAPSHOT = require('./fixtures/tenants/done-and-dusted-staging.json');

describe('tenant prompt facts', () => {
  const profile = profileFromSnapshot(SNAPSHOT);
  const prompt = buildSystemPrompt(profile);

  it('puts coverage towns, hours, and all 16 services in the live prompt', () => {
    const { expected, missing } = checkPromptFacts(profile, prompt);
    assert.deepEqual(missing, []);
    assert.equal(expected.filter((f) => f.kind === 'service').length, 16);
    assert.match(prompt, /- Coverage: Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, Syokimau/);
    assert.match(prompt, /Mon-Sun: 08:00-18:00 EAT/);
    assert.match(prompt, /Interior Window Cleaning/);
  });

  it('does not call the service area unknown when a coverage list exists', () => {
    assert.doesNotMatch(prompt, /Delivery \/ service area: \(not on file/);
    assert.match(prompt, /COVERAGE RULE: The Coverage line is the only service area/);
  });

  it('lets a stated fact win over an UNKNOWN line on the same topic', () => {
    assert.match(prompt, /wins over an UNKNOWN line on the same topic/);
  });

  it('keeps every configured policy key on one side: fact or unknown', () => {
    const split = factPolicyMap({
      payment: 'M-Pesa',
      min_notice: 'Book one day ahead',
      pet_policy: 'Pets stay in another room',
      provenance: {
        payment: { source: 'owner', confirmed: true },
        min_notice: { source: 'owner', confirmed: true },
        pet_policy: { source: 'seed' },
      },
      coverage_areas: ['county:nairobi', 'place:kitengela'],
      booking_mode: 'request',
      holds: { allowed: 'no' },
    });
    assert.equal(split.policies.min_notice, 'Book one day ahead');
    assert.deepEqual(split.policies.coverage_areas, ['county:nairobi', 'place:kitengela']);
    assert.ok(split.unknown.includes('Pet policy'));
    assert.equal(split.policies.booking_mode, undefined);
    assert.equal(split.policies.holds, undefined);
    const truth = buildLiveGroundTruth({
      businessName: 'Test',
      businessPolicies: {
        payment: 'M-Pesa',
        min_notice: 'Book one day ahead',
        provenance: { payment: { source: 'owner', confirmed: true } },
        coverage_areas: ['county:nairobi', 'place:kitengela'],
      },
    });
    assert.match(truth, /- Min notice: Book one day ahead/);
    assert.match(truth, /- Coverage: Nairobi, Kitengela/);
  });

  it('keeps an empty picked list as an empty service area', () => {
    const truth = buildLiveGroundTruth({
      businessName: 'Test',
      businessPolicies: { payment: 'Cash', coverage_areas: [] },
    });
    assert.match(truth, /- Coverage: \(none listed\)/);
  });
});
