// BRAIN_CONFIRMED_COVERAGE on the structured mouth (#614). HD_23445a4f780c
// spoke the D&D seed coverage list ("Ndiyo, tunafika Syokimau") although no
// owner had confirmed it. With the flag on, facts.js and verify's
// covered / not-covered lines use only owner-confirmed areas; with it off,
// nothing changes.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildFactTable, formatFactsBlock } = require('../../src/speech/structured/facts');
const { verifySay, dataLineFor } = require('../../src/speech/structured/verify');
const { runStructuredTurn } = require('../../src/speech/structured/turn');
const { correctionTurn } = require('../../src/speech/structured/schema');
const { getLanguagePack } = require('../../src/speech/structured/languages');
const source = require('../../src/speech/structured/coverageSource');
const { DUSTED, scripted } = require('./helpers');

const ON = { BRAIN_CONFIRMED_COVERAGE: 'on' };
const OWNER_META = { byPath: { 'policies.coverage_areas': { source: 'owner', confirmed_at: '2026-10-09T08:00:00Z' } } };
const SEED_META = { byPath: { 'policies.coverage_areas': { source: 'seed', confirmed_at: null } } };
const codes = (r) => r.problems.map((p) => p.code);

async function run(table, replies, { callerText, locked = 'en' }) {
  const { openStream } = scripted(replies);
  const said = [];
  await runStructuredTurn({
    openStream,
    locked,
    table,
    callerText,
    onSay: async (text) => said.push(text),
    correctionFor: (problems) => correctionTurn(locked, problems),
  });
  return said;
}

afterEach(() => source.resetCoverageSourceForTests());

describe('coverage source adapter', () => {
  it('uses the mirror while Brain confirmedCoverage.js is not on this branch', () => {
    assert.equal(source.coverageSourceKind(), 'mirror');
  });

  it('flag is on only for the exact value "on"', () => {
    assert.equal(source.confirmedCoverageOn({}), false);
    assert.equal(source.confirmedCoverageOn({ BRAIN_CONFIRMED_COVERAGE: 'true' }), false);
    assert.equal(source.confirmedCoverageOn({ BRAIN_CONFIRMED_COVERAGE: 'ON' }), false);
    assert.equal(source.confirmedCoverageOn(ON), true);
  });

  it('flag on: seed list or no meta is not speakable; an owner row is', () => {
    assert.deepEqual(source.speakableCoverage(DUSTED, { env: ON }), { gated: true, confirmed: false, areas: [] });
    assert.deepEqual(source.speakableCoverage({ ...DUSTED, fieldMeta: SEED_META }, { env: ON }).areas, []);
    const owned = source.speakableCoverage({ ...DUSTED, fieldMeta: OWNER_META }, { env: ON });
    assert.equal(owned.confirmed, true);
    assert.deepEqual(owned.areas, DUSTED.businessPolicies.coverage_areas);
    const confirmedBy = { byPath: { 'policies.coverage_areas': { source: 'seed', confirmed_by: 'owner-1' } } };
    assert.equal(source.speakableCoverage({ ...DUSTED, fieldMeta: confirmedBy }, { env: ON }).confirmed, true);
  });

  it('uses Brain speakableCoverageAreas when that module is present', () => {
    const seen = [];
    source.resetCoverageSourceForTests({
      confirmedCoverageEnabled: (env) => env.BRAIN_CONFIRMED_COVERAGE === 'on',
      speakableCoverageAreas: (profile, opts) => {
        seen.push(opts.env.BRAIN_CONFIRMED_COVERAGE);
        return ['place:kitengela'];
      },
      teamConfirmCoverageLine: (place) => `BRAIN confirm ${place}`,
    });
    assert.equal(source.coverageSourceKind(), 'brain');
    assert.deepEqual(source.speakableCoverage(DUSTED, { env: ON }), { gated: true, confirmed: true, areas: ['place:kitengela'] });
    assert.deepEqual(seen, ['on']);
    assert.equal(source.teamConfirmCoverageLine('Kisumu', 'en'), 'BRAIN confirm Kisumu');
    // Brain returns null (or []) when unconfirmed; a throw fails closed.
    source.resetCoverageSourceForTests({ confirmedCoverageEnabled: () => true, speakableCoverageAreas: () => null });
    assert.deepEqual(source.speakableCoverage(DUSTED, { env: ON }).areas, []);
    source.resetCoverageSourceForTests({ confirmedCoverageEnabled: () => true, speakableCoverageAreas: () => { throw new Error('x'); } });
    assert.deepEqual(source.speakableCoverage(DUSTED, { env: ON }).areas, []);
  });
});

describe('flag off: exactly as before', () => {
  it('fact table and coverage checks match the default build', () => {
    const before = buildFactTable(DUSTED, { speakerBound: false, env: {} });
    const off = buildFactTable(DUSTED, { speakerBound: false, env: { BRAIN_CONFIRMED_COVERAGE: 'off' } });
    assert.deepEqual(off.coverageAreas, DUSTED.businessPolicies.coverage_areas);
    assert.equal(formatFactsBlock(off), formatFactsBlock(before));
    assert.match(formatFactsBlock(off), /\[cov:syokimau\] Coverage: Syokimau/);
    assert.doesNotMatch(formatFactsBlock(off), /not confirmed/);
    assert.deepEqual(off.coverageGate, { gated: false, confirmed: false });
    const r = verifySay('Hatufiki Syokimau.', { locked: 'sw', table: off, callerText: 'Mnafika Syokimau?' });
    assert.deepEqual(codes(r), ['coverage_contradiction']);
    assert.equal(dataLineFor('Hatufiki Syokimau.', r.problems, { table: off, pack: getLanguagePack('sw'), callerText: 'Mnafika Syokimau?' }), 'Ndiyo, tunafika Syokimau.');
  });
});

describe('flag on, no owner-confirmed list (D&D seed, HD_23445a4f780c)', () => {
  const table = buildFactTable(DUSTED, { speakerBound: false, env: ON });

  it('no coverage rows reach the prompt; the prompt says the area is unconfirmed', () => {
    assert.deepEqual(table.coverageAreas, []);
    assert.equal(table.isCovered('Syokimau'), null);
    const block = formatFactsBlock(table);
    assert.doesNotMatch(block, /\[cov:/);
    assert.match(block, /owner has not confirmed any service area/);
  });

  it('a covered claim, a denial and an area list are all problems', () => {
    for (const [line, lang] of [
      ['Ndiyo, tunafika Syokimau.', 'sw'],
      ['Hatufiki Kisumu.', 'sw'],
      ['Yes, we cover Kitengela.', 'en'],
      ['Kisumu is outside our area.', 'en'],
      ['We serve Nairobi and the surrounding areas.', 'en'],
      ['We only serve nearby areas.', 'en'],
    ]) {
      const r = verifySay(line, { locked: lang, table, callerText: '' });
      assert.ok(codes(r).includes('coverage_unconfirmed'), `${line}: ${codes(r)}`);
    }
  });

  it('sentences with no coverage claim pass', () => {
    const r = verifySay('Sure, which area are you in?', { locked: 'en', table, callerText: 'Do you come to Syokimau?' });
    assert.deepEqual(codes(r), []);
  });

  it('the data line is "the team will confirm {place}", never "tunafika"', () => {
    const r = verifySay('Ndiyo, tunafika Syokimau.', { locked: 'sw', table, callerText: 'Mnafika Syokimau?' });
    assert.equal(
      dataLineFor('Ndiyo, tunafika Syokimau.', r.problems, { table, pack: getLanguagePack('sw'), callerText: 'Mnafika Syokimau?' }),
      'Nitaiomba timu yetu ithibitishe eneo la Syokimau.'
    );
    const en = verifySay('We serve Nairobi and the surrounding areas.', { locked: 'en', table, callerText: 'Do you come to Kisumu?' });
    assert.equal(
      dataLineFor('x', en.problems, { table, pack: getLanguagePack('en'), callerText: 'Do you come to Kisumu?' }),
      "I'll have the team confirm Kisumu."
    );
    // No place from the caller: no data line (the turn speaks the unverified line).
    assert.equal(dataLineFor('x', en.problems, { table, pack: getLanguagePack('en'), callerText: 'hello' }), '');
  });

  it('turn: the seed list is never spoken; the team-confirm line is', async () => {
    const listed = {
      lang: 'sw',
      intent: 'coverage',
      facts_used: [],
      say: ['Kama uko nje ya Nairobi, tunafika Kiambu, Kitengela, Juja, Ongata Rongai na Syokimau.'],
    };
    const said = await run(table, [listed, listed], { callerText: 'Mnafika Syokimau?', locked: 'sw' });
    assert.ok(!said.some((s) => /tunafika/i.test(s)), JSON.stringify(said));
    assert.ok(said.includes('Nitaiomba timu yetu ithibitishe eneo la Syokimau.'), JSON.stringify(said));
  });
});

describe('flag on, owner-confirmed list', () => {
  const owned = { ...DUSTED, fieldMeta: OWNER_META };
  const table = buildFactTable(owned, { speakerBound: false, env: ON });

  it('confirmed areas are cited and checked like today', () => {
    assert.match(formatFactsBlock(table), /\[cov:syokimau\] Coverage: Syokimau/);
    assert.doesNotMatch(formatFactsBlock(table), /not confirmed/);
    const r = verifySay('Hatufiki Syokimau.', { locked: 'sw', table, callerText: 'Mnafika Syokimau?' });
    assert.deepEqual(codes(r), ['coverage_contradiction']);
    assert.equal(dataLineFor('Hatufiki Syokimau.', r.problems, { table, pack: getLanguagePack('sw'), callerText: 'Mnafika Syokimau?' }), 'Ndiyo, tunafika Syokimau.');
  });

  it('only the confirmed list counts (Brain module returning a subset)', () => {
    source.resetCoverageSourceForTests({
      confirmedCoverageEnabled: () => true,
      speakableCoverageAreas: () => ['place:kitengela'],
    });
    const sub = buildFactTable(owned, { speakerBound: false, env: ON });
    assert.deepEqual(sub.coverageAreas, ['place:kitengela']);
    const r = verifySay('Yes, we cover Syokimau.', { locked: 'en', table: sub, callerText: 'Do you cover Syokimau?' });
    assert.deepEqual(codes(r), ['coverage_unbacked']);
  });
});
