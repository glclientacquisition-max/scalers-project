'use strict';
// Regression-9 harness checks: the read-back cue list shared by the persona and the write check.
const test = require('node:test');
const assert = require('node:assert');
const { isReadbackQuestion } = require('../evals/v2/lib/readback');
const { writeNeedsReadback } = require('../evals/v2/regression/cases');

test('read-back cues: EN + SW, incl. the #727 request read-back "Nipeleke ombi hili kwa timu?"', () => {
  for (const l of [
    'Carpet Cleaning on Friday 16 October at 10:00 in Kitengela, for Alvin. Shall I book it?',
    'Shall I send this request to the team?',
    'Carpet Cleaning, Ijumaa 16 Oktoba saa nne asubuhi, Kitengela, kwa Otieno. Nithibitishe?',
    'Deep Cleaning, Alhamisi 15 Oktoba saa nne asubuhi, Kilimani, kwa Wanjiru. Nipeleke ombi hili kwa timu?',
    'Tupeleke ombi hili kwa timu?',
    'Nitume ombi hili kwa timu?',
    'Oxford Metallic Set inapatikana. Nithibitishe: Oxford Metallic Set. Niweke oda?',
  ]) assert.ok(isReadbackQuestion(l), l);
});

test('not read-backs: statements, open questions, and "nikutumie" (an offer to message the caller)', () => {
  for (const l of [
    'Nipeleke ombi hili kwa timu.', // not a question
    'Ungependa huduma gani?',
    'Nikutumie ujumbe wa maelezo?',
    'Nikutumie link?',
    'Nitume?', // no object: too vague to count as confirming a write
    'Tupeleke wapi?',
    'Which service do you need?',
  ]) assert.ok(!isReadbackQuestion(l), l);
});

test('writeNeedsReadback: a write after "Nipeleke ombi hili kwa timu?" + yes is fine; after an open question it is flagged', () => {
  const w = [{ action: 'create_appointment', status: 'succeeded' }];
  const ok = { turns: [{ agentLine: 'Deep Cleaning, Alhamisi saa nne, Kilimani. Nipeleke ombi hili kwa timu?', toolResults: [] }, { agentLine: 'Sawa, nimeandika ombi lako.', toolResults: w }] };
  assert.deepEqual(writeNeedsReadback(ok), []);
  const bad = { turns: [{ agentLine: 'Nikutumie ujumbe?', toolResults: [] }, { agentLine: 'Sawa.', toolResults: w }] };
  assert.deepEqual(writeNeedsReadback(bad), ['write_without_readback t1']);
});
