'use strict';

// PROMPT_CACHE_PREFIX: the fixed part of the voice prompt for one business
// must be byte-identical across turns, minutes, callers and open visits, so
// Gemini's implicit cache (prefix match, 4,096-token minimum on 3.6 Flash)
// can reuse it. The live part (time, open/closed, caller card, open visits)
// sits at the end. Same text as before, new order.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemPrompt, buildSystemPromptParts } = require('../src/prompts');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');

const TENANTS = {
  aris: require('./fixtures/tenants/aris-prod.json'),
  doneAndDusted: require('./fixtures/tenants/done-and-dusted-staging.json'),
  jirani: require('./fixtures/tenants/jirani-staging.json'),
};

const MORNING = new Date('2026-10-18T05:01:00Z'); // 08:01 EAT
const NIGHT = new Date('2026-10-18T20:59:30Z'); // 23:59 EAT
const NEXT_DAY = new Date('2026-10-19T09:15:00Z');

const VISIT = {
  status: 'requested',
  service_name: 'Deep clean',
  when_text: 'Tuesday 10am',
  scheduled_at: '2026-10-20T07:00:00Z',
  caller_phone: '254700000001',
};

function profile(name, extra = {}) {
  const snap = JSON.parse(JSON.stringify(TENANTS[name]));
  return { ...profileFromSnapshot(snap), ...extra };
}

function sortedLines(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .sort();
}

describe('prompt cache prefix', () => {
  for (const name of Object.keys(TENANTS)) {
    it(`${name}: prefix is byte-identical across times, callers and open visits`, () => {
      const base = buildSystemPromptParts(profile(name), { now: MORNING }).prefix;
      const variants = [
        buildSystemPromptParts(profile(name), { now: NIGHT }),
        buildSystemPromptParts(profile(name), { now: NEXT_DAY }),
        buildSystemPromptParts(profile(name, { openAppointments: [VISIT] }), { now: NIGHT }),
        buildSystemPromptParts(
          profile(name, {
            openAppointments: [VISIT],
            callerMemory: { phone: '254700000002', name: 'Wanjiku', fileRole: 'primary' },
          }),
          { now: MORNING }
        ),
      ];
      for (const parts of variants) assert.equal(parts.prefix, base);
    });

    it(`${name}: live facts are only in the tail`, () => {
      const parts = buildSystemPromptParts(profile(name, { openAppointments: [VISIT] }), {
        now: NIGHT,
      });
      assert.ok(!parts.prefix.includes('CURRENT TIME IN KENYA'));
      assert.ok(!parts.prefix.includes('BUSINESS STATUS:'));
      assert.ok(!parts.prefix.includes('Deep clean (requested)'));
      assert.ok(parts.tail.includes('CURRENT TIME IN KENYA'));
      assert.ok(parts.tail.includes('BUSINESS STATUS:'));
      assert.ok(parts.tail.includes('Deep clean (requested)'));
    });

    it(`${name}: the full prompt is prefix then tail, and the live header is last`, () => {
      const p = profile(name);
      const parts = buildSystemPromptParts(p, { now: MORNING });
      const full = buildSystemPrompt(p, { now: MORNING });
      assert.equal(full, `${parts.prefix}\n\n${parts.tail}`);
      assert.ok(full.startsWith(parts.prefix));
      assert.ok(full.indexOf('CONTEXT HEADER (live') > full.indexOf('Conversation rules'));
    });

    it(`${name}: prefix is long enough for Gemini implicit caching (about 4,096 tokens)`, () => {
      // Rough guide: about 4 characters per token for this English prompt.
      const { prefix } = buildSystemPromptParts(profile(name), { now: MORNING });
      assert.ok(prefix.length / 4 >= 4096, `prefix ≈ ${Math.round(prefix.length / 4)} tokens`);
    });
  }

  it('the open-visit lines move to the tail with the same text', () => {
    const p = profile('doneAndDusted', { openAppointments: [VISIT] });
    const withVisits = buildLiveGroundTruth(p);
    const without = buildLiveGroundTruth(p, { omitOpenVisits: true });
    const { tail } = buildSystemPromptParts(p, { now: MORNING });
    const moved = sortedLines(withVisits).filter((line) => !sortedLines(without).includes(line));
    assert.ok(moved.length > 0);
    for (const line of moved) assert.ok(tail.includes(line), line);
  });

  it('a tenant with its own llm prompt keeps the same split', () => {
    const p = profile('aris', { llmSystemPrompt: 'You are the receptionist. Be kind.' });
    const a = buildSystemPromptParts(p, { now: MORNING });
    const b = buildSystemPromptParts(p, { now: NIGHT });
    assert.equal(a.prefix, b.prefix);
    assert.ok(a.prefix.includes('You are the receptionist. Be kind.'));
    assert.ok(a.tail.includes('CURRENT TIME IN KENYA'));
  });
});
