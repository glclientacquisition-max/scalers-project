'use strict';
// Regression-9 R8 (HD_2847152f6c1e T4): no hold after a filler; one filler/hold slot the answer pre-empts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../src/speech/toolSmooth');
const { createAudioSlot, fillerSlotEnabled } = require('../src/speech/turnArbiter');
const fx = require('./fixtures/tool-smooth/HD_2847152f6c1e-T4.json');

test('shouldQueueHold: never after a filler; unchanged without fillerPlayed', () => {
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 0, played: 0, fillerPlayed: true }), false);
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 0, played: 0 }), true);
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 0, played: 0, fillerPlayed: false }), true);
});
test('HD_2847 T4 replay through the slot: filler, then the receipt', () => {
  const slot = createAudioSlot();
  const heard = [];
  for (const line of fx.heard) {
    const kind = line === 'Mm-hmm.' ? 'filler' : /check|second|moment/i.test(line) ? 'hold' : 'answer';
    if (kind === 'answer') { slot.preempt(); heard.push(line); continue; }
    const fillerPlayed = slot.fillerPlayed();
    if (kind === 'hold' && !T.shouldQueueHold({ toolPending: true, remainingMs: 0, played: 0, fillerPlayed })) continue;
    if (slot.claim(kind)) heard.push(line);
  }
  assert.deepEqual(heard, fx.expectedHeard);
});
test('slot rules: hold lines share the slot; the answer closes it; reset per turn', () => {
  const s = createAudioSlot();
  assert.equal(s.claim('hold'), true);
  assert.equal(s.claim('hold'), true);
  assert.equal(s.claim('filler'), false);
  s.preempt();
  assert.equal(s.claim('hold'), false);
  assert.equal(s.claim('filler'), false);
  s.reset();
  assert.equal(s.claim('filler'), true);
  assert.equal(s.claim('filler'), false);
  assert.equal(s.claim('hold'), false);
});
test('flag off by default; server wiring', () => {
  assert.equal(fillerSlotEnabled({}), false);
  assert.equal(fillerSlotEnabled({ VOICE_FILLER_SLOT: 'on' }), true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const audioSlot = fillerSlotEnabled\(\) \? createAudioSlot/);
  assert.match(src, /fillerPlayed: audioSlot\.fillerPlayed\(\)/);
  assert.match(src, /audioSlot\.claim\('filler'\)/);
  assert.match(src, /if \(audioSlot\) \{ audioSlot\.preempt\(\); stopHoldFill\(\); \}/);
});
