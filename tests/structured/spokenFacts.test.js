'use strict';

// VOICE_SPOKEN_FACTS on the structured mouth (HD_d199dbbf6b79).
// Mirror part runs everywhere; the rendered-phrase and time-guard part runs
// when Voice's src/speech/spokenFacts (#633) is on the branch.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildFactTable } = require('../../src/speech/structured/facts');
const { verifySay, dataLineFor } = require('../../src/speech/structured/verify');
const { getLanguagePack } = require('../../src/speech/structured/languages');
const { spokenFactsSourceKind, parseWhen } = require('../../src/speech/structured/spokenFactsSource');

const NOW = new Date('2026-10-09T08:45:00Z'); // Friday 11:45 EAT
const CARD = 'Carpet Cleaning | Saturday 10 October 2026, 9 AM | requested | Kitengela';
const state = { returning: { openVisits: [CARD] } };
const ON = { VOICE_SPOKEN_FACTS: 'on' };
const voice = spokenFactsSourceKind() === 'voice';

function table(env) {
  return buildFactTable({}, { state, speakerBound: true, env, now: NOW });
}
const cite = [{ id: 'vis:1' }];

describe('structured spoken facts: flag off is unchanged', () => {
  it('a card-line visit stays the bare "visit" fact (today)', () => {
    const t = table({});
    assert.equal(t.byId.get('vis:1').text, 'visit');
    const r = verifySay('Your visit is on Saturday at 9 AM.', { locked: 'en', table: t, factsUsed: cite, env: {} });
    assert.deepEqual(r.problems.map((p) => p.code), ['unbacked_number']);
  });
  it('only exactly "on" enables it', () => {
    assert.equal(table({ VOICE_SPOKEN_FACTS: 'true' }).byId.get('vis:1').text, 'visit');
  });
});

describe('structured spoken facts: backed numbers (latency, HD_d199 t2/t3)', () => {
  it('a card-line visit is a full fact, so its 9 is backed (no regeneration)', () => {
    const t = table(ON);
    const vis = t.byId.get('vis:1');
    assert.equal(vis.label, 'Carpet Cleaning');
    assert.match(vis.text, /^Carpet Cleaning, Saturday 10 October 2026, 9 AM, requested, Kitengela/);
    const r = verifySay('Your Carpet Cleaning visit is on Saturday at 9 AM.', { locked: 'en', table: t, factsUsed: cite, env: ON });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });
  it('parses the stored when-text to EAT minutes and an instant', () => {
    assert.deepEqual(parseWhen('Saturday 10 October 2026, 9 AM'), { minutes: 540, iso: '2026-10-10T06:00:00.000Z' });
    assert.deepEqual(parseWhen('soon'), { minutes: null, iso: null });
  });
});

describe('structured spoken facts: rendered phrases and time guard', { skip: !voice && 'spokenFacts module not on this branch' }, () => {
  it('the vis fact carries the rendered phrases', () => {
    const vis = table(ON).byId.get('vis:1');
    assert.equal(vis.minutes, 540);
    assert.equal(vis.spoken.sw, 'kesho Jumamosi, saa tatu asubuhi');
    assert.equal(vis.spoken.en, 'tomorrow, Saturday, at 9 AM');
  });
  it('a Kiswahili clock slip is fixed in place and backed', () => {
    const r = verifySay('Ziara yako ni kesho Jumamosi, saa 9 asubuhi.', { locked: 'sw', table: table(ON), factsUsed: cite, env: ON });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.equal(r.fixed, 'Ziara yako ni kesho Jumamosi, saa tatu asubuhi.');
  });
  it('a wrong visit time is a time_mismatch with a code line', () => {
    const t = table(ON);
    const r = verifySay('Ziara yako ni saa nne asubuhi.', { locked: 'sw', table: t, factsUsed: cite, env: ON });
    assert.ok(r.problems.some((p) => p.code === 'time_mismatch'));
    assert.equal(
      dataLineFor('Ziara yako ni saa nne asubuhi.', r.problems, { table: t, pack: getLanguagePack('sw') }),
      'Ziara yako ya Carpet Cleaning ni kesho Jumamosi, saa tatu asubuhi.'
    );
    const en = verifySay('Your visit is at 10 AM.', { locked: 'en', table: t, factsUsed: cite, env: ON });
    assert.ok(en.problems.some((p) => p.code === 'time_mismatch'));
    assert.equal(dataLineFor('Your visit is at 10 AM.', en.problems, { table: t, pack: getLanguagePack('en') }),
      'Your Carpet Cleaning visit is tomorrow, Saturday, at 9 AM.');
  });
  it('a time the caller asked for is not a mismatch', () => {
    const r = verifySay('Sawa, tuhamishe ziara hadi saa 10 asubuhi?', {
      locked: 'en', table: table(ON), factsUsed: cite, env: ON, callerText: 'Can you move the visit to 10 AM?',
    });
    assert.ok(!r.problems.some((p) => p.code === 'time_mismatch'));
  });
});
