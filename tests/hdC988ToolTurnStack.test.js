// Regression lock for HD_c98820e579e1 (staging kitchen-sink 8aef85bc,
// 2026-10-08 23:15 EAT, t10) and HD_4d6ac592aeb3 (20:09 EAT, t4).
// The tool turns spoke three acknowledgements before any content:
//   t10: "Alright." (ack 23:15:03.400) -> "Let me check." (hold 04.363)
//        -> "Okay, I've saved your request." (04.935)
//   t4:  "Alright." (47.554) -> "Just a second." (50.508)
//        -> "Okay. They'll call you back." (53.152)
// The hold is skipped while the ack is recent, and the outcome drops its
// "Okay." lead once an ack or hold played this turn.
// Run: node --test tests/hdC988ToolTurnStack.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  HOLD_AFTER_ACK_MS,
  holdSpeaksAfterAck,
  trimAckLead,
  createToolHoldSession,
  TOOL_HOLD_PACKS,
} = require('../src/speech/toolHold');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Wall-clock marks from the Railway log (ms within the minute).
const C988_T10 = { ackAt: 3400, holdAt: 4363, outcome: "Okay, I've saved your request." };
const D6A_T4 = { ackAt: 47554, holdAt: 50508, outcome: "Okay. They'll call you back." };

describe('HD_c98820e579e1 t10: no hold line right after the thinking-ack', () => {
  it('skips the hold 963 ms after "Alright."', () => {
    assert.equal(
      holdSpeaksAfterAck({ kind: 'hold', ackAtMs: C988_T10.ackAt, nowMs: C988_T10.holdAt }),
      false
    );
  });

  it('skips the hold 2954 ms after the ack (HD_4d6ac592aeb3 t4)', () => {
    assert.equal(
      holdSpeaksAfterAck({ kind: 'hold', ackAtMs: D6A_T4.ackAt, nowMs: D6A_T4.holdAt }),
      false
    );
  });

  it('keeps the hold on a long wait, and when no ack played', () => {
    assert.equal(
      holdSpeaksAfterAck({ kind: 'hold', ackAtMs: 1000, nowMs: 1000 + HOLD_AFTER_ACK_MS }),
      true
    );
    assert.equal(holdSpeaksAfterAck({ kind: 'hold', ackAtMs: 0, nowMs: 5000 }), true);
  });

  it('never skips a result line (empty-file / file read follow-up)', () => {
    assert.equal(holdSpeaksAfterAck({ kind: 'result', ackAtMs: 4000, nowMs: 4100 }), true);
  });

  it('the hold packs are unchanged', () => {
    const session = createToolHoldSession({ language: 'en', seed: 'HD_c98820e579e1:9' });
    const begun = session.begin();
    assert.equal(begun.kind, 'hold');
    assert.ok(TOOL_HOLD_PACKS.en.includes(begun.line));
    assert.ok(TOOL_HOLD_PACKS.sw.includes('Ngoja kidogo.'));
  });
});

describe('Tool outcome drops the redundant "Okay" after an ack', () => {
  it('t10: "I\'ve saved your request."', () => {
    assert.equal(trimAckLead(C988_T10.outcome, { acked: true }), "I've saved your request.");
  });

  it('t4: "They\'ll call you back."', () => {
    assert.equal(trimAckLead(D6A_T4.outcome, { acked: true }), "They'll call you back.");
  });

  it('Kiswahili "Sawa," lead is dropped too', () => {
    assert.equal(
      trimAckLead('Sawa, nimehifadhi ombi lako.', { acked: true }),
      'Nimehifadhi ombi lako.'
    );
  });

  it('no ack this turn: the line is unchanged', () => {
    assert.equal(trimAckLead(C988_T10.outcome, { acked: false }), C988_T10.outcome);
  });

  it('a bare "Okay." or a word starting with ok is never emptied or cut', () => {
    assert.equal(trimAckLead('Okay.', { acked: true }), 'Okay.');
    assert.equal(trimAckLead('Okoa time: booked for 9 AM.', { acked: true }), 'Okoa time: booked for 9 AM.');
    assert.equal(trimAckLead('Sawasawa, imehifadhiwa.', { acked: true }), 'Sawasawa, imehifadhiwa.');
  });
});

describe('server.js wiring', () => {
  it('speakToolHold checks the same-turn ack before speaking a hold', () => {
    const start = SERVER.indexOf('async function speakToolHold(');
    const body = SERVER.slice(start, start + 900);
    assert.match(body, /thinkingAckTurn === activeTurnTiming/);
    assert.match(body, /holdSpeaksAfterAck\(/);
    assert.match(body, /tool hold skipped after thinking-ack/);
  });

  it('the thinking-ack timer records the turn and time', () => {
    const at = SERVER.indexOf('fillerStarted = true;');
    const block = SERVER.slice(at, at + 300);
    assert.match(block, /thinkingAckTurn = turnTiming/);
    assert.match(block, /thinkingAckAtMs = Date\.now\(\)/);
  });

  it('the tool outcome is trimmed and the transcript matches what is spoken', () => {
    const at = SERVER.indexOf('const outcomeLine = trimAckLead(');
    assert.ok(at > 0);
    const block = SERVER.slice(at, at + 300);
    assert.match(block, /callTranscript\.pushAgent\(outcomeLine\)/);
    assert.match(block, /speakText\(outcomeLine\)/);
  });

  it('tool turns still get the adaptive filler (#617)', () => {
    const start = SERVER.indexOf('const useFiller =');
    const gate = SERVER.slice(start, start + 200);
    assert.doesNotMatch(gate, /needsImmediateProgress/);
  });
});
