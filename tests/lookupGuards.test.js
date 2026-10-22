'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { polishSpokenDetail, trimSpokenServiceDump } = require('../src/conversation/dynamicSpeech');
const { buildSystemPrompt } = require('../src/prompts');
const { profiles, FALLBACK } = require('../evals/replay/profiles');

function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env[name];
    else process.env[name] = prev;
  }
}

test('flag off still replaces an unasked service dump', () => {
  withEnv('VOICE_LOOKUPS', null, () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      const line = trimSpokenServiceDump("I'm doing well, thank you! We specialize in couch, carpet, and mattress cleaning.");
      assert.equal(line, 'We can help with that. What do you need done?');
      assert.match(warns.join('\n'), /reason=service_dump/);
    } finally {
      console.warn = orig;
    }
  });
});

test('flag on keeps a catalogue list and names the dump that became slop', () => {
  withEnv('VOICE_LOOKUPS', 'on', () => {
    const profile = profiles().list;
    const reasons = [];
    const kept = trimSpokenServiceDump(
      'We do deep cleaning, standard cleaning, sofa cleaning, and carpet cleaning.',
      { profile, language: 'en', callerText: 'Hello', dropReasons: reasons }
    );
    assert.match(kept, /deep cleaning/);
    assert.match(kept, /carpet cleaning/);
    assert.equal(reasons.includes('service_dump'), false);

    const dumped = polishSpokenDetail(
      'We specialize in couch, carpet, and mattress cleaning.',
      { profile, language: 'en', callerTurns: ['Hello'], state: { conversation: {} } }
    );
    assert.ok(dumped.dropReasons.includes('service_dump'));
    assert.ok(dumped.dropReasons.includes('service_dump→slop') || dumped.dropReasons.includes('slop'));
    assert.ok(dumped.text.length < 'We specialize in couch, carpet, and mattress cleaning.'.length);
    assert.ok(dumped.dropReasons.length > 0);
  });
});

test('a lowercase fragment is replaced whole when lookups are on', () => {
  withEnv('VOICE_LOOKUPS', 'on', () => {
    const res = polishSpokenDetail('with the owner to confirm it for you.', {
      profile: profiles().carry,
      language: 'en',
      callerTurns: ['What is your till number?'],
      state: { conversation: {} },
    });
    assert.equal(res.text, FALLBACK);
    assert.ok(res.dropReasons.includes('sentence_fragment'));
    assert.doesNotMatch(res.text, /^with the/);
  });
});

test('lookup speech is not re-parsed', () => {
  withEnv('VOICE_LOOKUPS', 'on', () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      const line = 'Ada ya usafiri hadi Kileleshwa ni shilingi mia tatu.';
      const res = polishSpokenDetail(line, { lookupSpeech: true, profile: profiles().carry, language: 'sw' });
      assert.equal(res.text, line);
      assert.equal(res.dropReasons.length, 0);
      assert.equal(warns.some((row) => row.includes(line)), false);
    } finally {
      console.warn = orig;
    }
  });
});

test('persona-only prompt drops the compiled price and clock', () => {
  const profile = {
    businessName: 'Usafi Mtaa',
    agentName: 'Akinyi',
    llmSystemPrompt: 'You are warm.\nDeep clean KSh 9,500.\nWe open at 7:41 AM.',
  };
  withEnv('VOICE_PERSONA_ONLY_PROMPT', null, () => {
    withEnv('VOICE_FACT_REFS', null, () => {
      const off = buildSystemPrompt(profile);
      assert.match(off, /KSh 9,500/);
      assert.match(off, /7:41 AM/);
    });
  });
  withEnv('VOICE_PERSONA_ONLY_PROMPT', 'on', () => {
    withEnv('VOICE_FACT_REFS', null, () => {
      const on = buildSystemPrompt(profile);
      assert.doesNotMatch(on, /KSh 9,500/);
      assert.doesNotMatch(on, /7:41 AM/);
      assert.match(on, /warm/);
    });
  });
});
