const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteCrossLanguageFillers } = require('../../src/speech/structured/crossLanguageFiller');
const { runStructuredTurn } = require('../../src/speech/structured/turn');
const { correctionTurn } = require('../../src/speech/structured/schema');
const { dustedTable, scripted } = require('./helpers');

const r = (s, lang = 'en') => rewriteCrossLanguageFillers(s, lang).text;

describe('cross-language fillers under the language lock (staging 5bbb0871 turn 13)', () => {
  it('en lock: sawa/poa become okay, ndio/ndiyo become yes, eeh is dropped', () => {
    assert.equal(r('Okay, Sawa.'), 'Okay.');
    assert.equal(r('Sawa, I will book that for you.'), 'Okay, I will book that for you.');
    assert.equal(r('Poa.'), 'Okay.');
    assert.equal(r('Ndio, we come on Saturday.'), 'Yes, we come on Saturday.');
    assert.equal(r('Yes, ndiyo.'), 'Yes.');
    assert.equal(r('Eeh, that works.'), 'That works.');
    assert.equal(r('Okay, poa, sawa.'), 'Okay.');
    assert.equal(r('Eeh.'), '');
  });

  it('en lock: ordinary English and names are untouched', () => {
    for (const s of ['We clean sofas and carpets.', 'Okay, when should we come?', 'Thank you, Alvin. Have a great day!']) {
      assert.deepEqual(rewriteCrossLanguageFillers(s, 'en'), { text: s, changed: false, words: [] });
    }
  });

  it('sw and sheng locks keep okay and their own fillers', () => {
    assert.equal(r('Okay, sawa. Tutakuja kesho.', 'sw'), 'Okay, sawa. Tutakuja kesho.');
    assert.equal(r('Poa, okay.', 'sheng'), 'Poa, okay.');
  });

  it('the turn engine speaks "Okay." for "Okay, Sawa." in one call, no regeneration', async () => {
    const table = dustedTable();
    const value = {
      lang: 'en',
      intent: 'booking',
      facts_used: [],
      say: ['Okay, Sawa.'],
      tool: { name: 'update_appointment', args_json: '{"status":"requested","when_text":"Saturday 10 October 2026, 1:00 PM"}' },
    };
    const { openStream, calls } = scripted([value]);
    const said = [];
    const result = await runStructuredTurn({
      openStream,
      locked: 'en',
      table,
      callerText: '1:00 PM is fine.',
      onSay: async (text) => said.push(text),
      correctionFor: (problems) => correctionTurn('en', problems),
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(said, ['Okay.']);
    const t = result.transforms.find((row) => row.reason === 'cross_language_filler');
    assert.ok(t);
    assert.equal(t.before, 'Okay, Sawa.');
    assert.equal(t.after, 'Okay.');
    assert.deepEqual(t.words, ['sawa']);
  });

  it('a say[] made only of a dropped filler speaks nothing for it and keeps the rest', async () => {
    const table = dustedTable();
    const { openStream } = scripted([{ lang: 'en', intent: 'booking', facts_used: [], say: ['Eeh.', 'When should we come?'] }]);
    const said = [];
    await runStructuredTurn({
      openStream,
      locked: 'en',
      table,
      callerText: 'I want a cleaning.',
      onSay: async (text) => said.push(text),
      correctionFor: (problems) => correctionTurn('en', problems),
    });
    assert.deepEqual(said, ['When should we come?']);
  });
});
