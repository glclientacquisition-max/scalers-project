'use strict';
// Regression-9 R7 (HD_2847152f6c1e T3): open identity ask + a different question -> answer, no repeat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { shouldAskFileName, callerTurnIsOtherRequest, nameGateAnswerEnabled } = require('../src/speech/callerFileSpeech');
const fx = require('./fixtures/name-gate/HD_2847152f6c1e-T3.json');

test('HD_2847 T3: the stock question suppresses the repeat (EN + SW)', () => {
  for (const q of Object.values(fx.callerText)) assert.equal(shouldAskFileName({ askedTurns: fx.askedTurns, callerText: q }), fx.expected.askAgain, q);
});
test('first ask always goes; answers are not requests; never a third ask', () => {
  assert.equal(shouldAskFileName({ askedTurns: 0, callerText: 'Do you have diaries?' }), true);
  for (const a of ['Yes.', 'Ndio.', 'No, this is Brian.', 'Hapana, mimi ni Achieng.']) assert.equal(callerTurnIsOtherRequest(a), false, a);
  for (const q of ['How much is it?', 'Bei ni ngapi?', 'Mnafungua saa ngapi?', 'Where are you located?']) assert.equal(callerTurnIsOtherRequest(q), true, q);
  assert.equal(shouldAskFileName({ askedTurns: 1, callerText: 'Hmm.' }), true);
  assert.equal(shouldAskFileName({ askedTurns: 2, callerText: 'Hmm.' }), false);
});
test('flag off by default; server gates askingName on it', () => {
  assert.equal(nameGateAnswerEnabled({}), false);
  assert.equal(nameGateAnswerEnabled({ VOICE_NAME_GATE_ANSWER: '1' }), true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /nameAskDue &&\s*\(!nameGateAnswerEnabled\(\) \|\| shouldAskFileName\(\{ askedTurns: fileNameAsksCommitted, callerText: clean \}\)\)/);
});
