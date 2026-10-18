'use strict';

// HD_49d726c3dc9b (prod Aris, 18 Oct 2026): model outputText reached Voice with
// spaces missing ("OnTuesday", "Weopenat", "Karubusana,Alvin!"). Our stream join,
// sentence splitter and stream buffer only ever keep or add spaces, so the glue
// came from Gemini. These tests pin that with the exact prod strings, pin the new
// per-turn join evidence on the model trace, and pin that the guard reads glued
// numbers the same as spaced ones (detection only; spoken text is unchanged).

const test = require('node:test');
const assert = require('node:assert/strict');

const { joinSpokenPieces, createSpokenStreamBuffer } = require('../src/speech/spokenStreamBuffer');
const { createStreamJoinTrace } = require('../src/speech/streamJoinTrace');
const { createMemorySink, createVoiceTrace } = require('../src/speech/voiceTrace');
const { numbersIn, numberReadingText } = require('../src/conversation/numberWords');
const { clockKeys } = require('../src/conversation/trustedFacts');
const { guardSpokenReply, splitSentences } = require('../src/conversation/speechGuard');

const PROD_GLUED = [
  'OnTuesday, we will be open from 9:30 AM to 6:00 PM. Will you be passing by then, Alvin?',
  'Weopen at 9:30 AM in the morning on Tuesday.',
  'Weopenat 9:30 AM and close at 6:00 PM on Tuesday.',
  'Karubusana,Alvin! Have a great day ahead.',
];
const SPACED = [
  'On Tuesday, we will be open from 9:30 AM to 6:00 PM. Will you be passing by then, Alvin?',
  'We open at 9:30 AM in the morning on Tuesday.',
  'We open at 9:30 AM and close at 6:00 PM on Tuesday.',
  'Karibu sana, Alvin! Have a great day ahead.',
];

const squash = (s) => String(s).replace(/\s+/g, '');

/** Gemini-style deltas: words with their leading space, a few words per chunk. */
function deltasOf(text, words = 3) {
  const parts = text.match(/\s*\S+/g) || [];
  const out = [];
  for (let i = 0; i < parts.length; i += words) out.push(parts.slice(i, i + words).join(''));
  return out;
}

function streamJoin(deltas) {
  const trace = createStreamJoinTrace();
  let full = '';
  for (const d of deltas) {
    const before = full;
    full = joinSpokenPieces(full, d);
    trace.note(before, d, full);
  }
  return { full, stats: trace.summary() };
}

test('stream join keeps every space Gemini sends (exact spaced strings)', () => {
  for (const text of SPACED) {
    for (const size of [1, 2, 3, 5]) {
      assert.equal(streamJoin(deltasOf(text, size)).full, text, `size=${size}`);
    }
  }
});

test('stream join never removes characters at any split point (exact prod strings)', () => {
  for (const text of [...PROD_GLUED, ...SPACED]) {
    for (let i = 1; i < text.length; i += 1) {
      const joined = joinSpokenPieces(text.slice(0, i), text.slice(i));
      assert.equal(squash(joined), squash(text));
      assert.ok(joined.length >= text.length);
    }
  }
});

test('glue inside one delta reaches outputText unchanged; the join cannot make it', () => {
  // "We" + "open" across deltas is spaced by the opener rule, and "," + "Alvin"
  // by the comma rule, so the prod strings can only come from inside a delta.
  assert.equal(joinSpokenPieces('We', 'open at 9:30 AM'), 'We open at 9:30 AM');
  assert.equal(joinSpokenPieces('Karubusana,', 'Alvin!'), 'Karubusana, Alvin!');
  const { full, stats } = streamJoin(['Karubusana,Alvin!', ' Have a great', ' day ahead.']);
  assert.equal(full, PROD_GLUED[3]);
  assert.deepEqual(stats, { deltas: 3, unspacedJoins: 0, addedSpaces: 0, unspacedSamples: [] });
});

test('join trace counts boundaries where neither side carried the space', () => {
  const { full, stats } = streamJoin(['On', 'Tuesday, we will', ' be open from', ' 9:30 AM to 6:00 PM.']);
  assert.equal(full, 'OnTuesday, we will be open from 9:30 AM to 6:00 PM.');
  assert.equal(stats.deltas, 4);
  assert.equal(stats.unspacedJoins, 1);
  assert.deepEqual(stats.unspacedSamples, ['On|Tuesday, we ']);
  const added = streamJoin(['Karubusana,', 'Alvin!']).stats;
  assert.equal(added.addedSpaces, 1);
  assert.equal(added.unspacedJoins, 0);
  // Mid-word slices are normal streaming and counted, never changed.
  assert.equal(streamJoin(['cle', 'aning']).full, 'cleaning');
});

test('sentence splitter and stream buffer keep spaces (exact strings)', () => {
  for (const text of [...SPACED, ...PROD_GLUED]) {
    assert.equal(splitSentences(text).join(' '), text);
  }
  for (const text of SPACED) {
    const buffer = createSpokenStreamBuffer({});
    for (const d of deltasOf(text, 2)) buffer.push(d);
    buffer.finish();
    assert.equal(buffer.getSpokenEmitted().replace(/\s+/g, ' ').trim(), text);
  }
});

test('model trace stage carries the join counts', () => {
  const sink = createMemorySink();
  const trace = createVoiceTrace({ enabled: true, sink, callId: () => 'HD_49d726c3dc9b' });
  trace.beginTurn({ callerText: 'Uh, Tuesday at what time will you be open?' });
  trace.noteModelOutput({
    outputText: PROD_GLUED[0],
    stream: { deltas: 9, unspacedJoins: 0, addedSpaces: 0, unspacedSamples: [] },
  });
  trace.noteModelOutput({ outputText: 'Karibu.' });
  const turn = trace.commitTurn({ outcome: 'ok' });
  const models = turn.stages.filter((row) => row.stage === 'model');
  assert.deepEqual(models[0].stream, { deltas: 9, unspacedJoins: 0, addedSpaces: 0, unspacedSamples: [] });
  assert.equal('stream' in models[1], false);
});

test('glued clocks and shillings read like spaced ones; product codes stay unread', () => {
  const same = [
    ['Weopenfrom9:30 AM to6:00 PM.', 'We open from 9:30 AM to 6:00 PM.'],
    ['OnTuesday, we will be open from 9:30 AM to 6:00 PM.', 'On Tuesday, we will be open from 9:30 AM to 6:00 PM.'],
    ['Weopenat 9:30 AM and close at 6:00 PM on Tuesday.', 'We open at 9:30 AM and close at 6:00 PM on Tuesday.'],
    ['It costs KSh500.', 'It costs KSh 500.'],
    ['It is500 shillings.', 'It is 500 shillings.'],
  ];
  for (const [glued, spaced] of same) {
    assert.deepEqual([...numbersIn(glued)].sort(), [...numbersIn(spaced)].sort(), glued);
    assert.deepEqual([...clockKeys(glued)].sort(), [...clockKeys(spaced)].sort(), glued);
  }
  assert.deepEqual([...numbersIn('from9:30 AM')].sort(), ['30', '9']);
  assert.deepEqual([...numbersIn('costs KSh500')], ['500']);
  assert.deepEqual([...numbersIn('A4 notebooks')], []);
  assert.deepEqual([...numbersIn('Casio fx991ES')], []);
  // Reading only: the text itself is never what gets spoken.
  assert.equal(numberReadingText('costs KSh500'), 'costs KSh 500');
});

function ctx(caller) {
  return {
    callerTurns: [caller],
    profile: {},
    toolResults: [],
    capabilities: {},
    state: { caller: {}, conversation: { answersReceived: [], turnCount: 5 } },
    language: 'en',
    allowEmpty: true,
  };
}

test('an invented glued price no longer slips past unsaid_number', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const out = guardSpokenReply('The stapler costs KSh500. Anything else?', ctx('How much is the stapler?'));
    assert.equal(/500/.test(out), false, out);
    const glued = guardSpokenReply('The stapler is500 shillings. Anything else?', ctx('How much is the stapler?'));
    assert.equal(/500/.test(glued), false, glued);
    // A caller-said number glued by the model is still allowed.
    const said = guardSpokenReply('Sawa, KSh500 noted.', ctx('My budget is 500 shillings.'));
    assert.match(said, /KSh500/);
  } finally {
    console.warn = warn;
  }
});
