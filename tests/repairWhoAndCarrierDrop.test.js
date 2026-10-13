delete process.env.FACT_HASH_MODE;
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { repairWhoEnabled, isRepairWhoUtterance } = require('../src/speech/repairWho');
const {
  carrierDropCallbackEnabled,
  isCarrierDropClose,
  requestInFlight,
} = require('../src/speech/carrierDrop');
const {
  isHearAgainUtterance,
  classifyCallerUtteranceKind,
  decideCallerEvent,
} = require('../src/speech/turnTaking');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const PREV_WHO = process.env.VOICE_REPAIR_WHO;
const PREV_DROP = process.env.VOICE_CARRIER_DROP_CALLBACK;

afterEach(() => {
  if (PREV_WHO == null) delete process.env.VOICE_REPAIR_WHO;
  else process.env.VOICE_REPAIR_WHO = PREV_WHO;
  if (PREV_DROP == null) delete process.env.VOICE_CARRIER_DROP_CALLBACK;
  else process.env.VOICE_CARRIER_DROP_CALLBACK = PREV_DROP;
});

describe('VOICE_REPAIR_WHO (HD_cc455b0ce145 / HD_f80ab5e17d83)', () => {
  it('defaults off and leaves who/hmm as non-hear-again', () => {
    delete process.env.VOICE_REPAIR_WHO;
    assert.equal(repairWhoEnabled({}), false);
    assert.equal(isHearAgainUtterance('who'), false);
    assert.equal(isHearAgainUtterance('hmm'), false);
    assert.equal(classifyCallerUtteranceKind('who'), 'speech');
  });

  it('on: who / hmm / nani are hear_again and replay', () => {
    process.env.VOICE_REPAIR_WHO = 'on';
    assert.equal(isRepairWhoUtterance('Who?'), true);
    assert.equal(isHearAgainUtterance('who'), true);
    assert.equal(isHearAgainUtterance('hmm'), true);
    assert.equal(isHearAgainUtterance('nani'), true);
    assert.equal(classifyCallerUtteranceKind('Who?'), 'hear_again');
    const d = decideCallerEvent({
      text: 'Who?',
      speaking: false,
      turnBusy: false,
      lastAgentText: 'Good morning, Aris, this is Shy. Am I speaking with Alvin?',
      lastAgentAskedQuestion: true,
      replayText: 'Good morning, Aris, this is Shy. Am I speaking with Alvin?',
      phase: 'idle',
    });
    assert.equal(d.reason, 'hear_again');
    assert.equal(d.replay, true);
  });
});

describe('carrier drop (HD_8bd4ebc460d4)', () => {
  it('detects 1006 without Completed; ignores Completed-before-close', () => {
    assert.equal(isCarrierDropClose({ code: 1006, completedBeforeClose: false }), true);
    assert.equal(isCarrierDropClose({ code: 1006, completedBeforeClose: true }), false);
    assert.equal(isCarrierDropClose({ code: 1000 }), false);
  });

  it('requestInFlight reads pending outcome and slots', () => {
    assert.equal(requestInFlight(null), false);
    assert.equal(
      requestInFlight({ conversation: { pendingToolOutcome: 'Saved.' } }),
      true
    );
    assert.equal(requestInFlight({ slots: { service: 'cleaning' } }), true);
  });

  it('callback flag defaults off', () => {
    assert.equal(carrierDropCallbackEnabled({}), false);
    assert.equal(carrierDropCallbackEnabled({ VOICE_CARRIER_DROP_CALLBACK: 'on' }), true);
  });
});

describe('server wiring', () => {
  it('gates repair_who and carrier_drop behind flags', () => {
    assert.ok(SERVER.includes('VOICE_REPAIR_WHO') || SERVER.includes('repairWhoEnabled'));
    assert.ok(SERVER.includes('carrierDropCallbackEnabled'));
    assert.ok(SERVER.includes('repair_who replay'));
    assert.ok(SERVER.includes('carrier_drop'));
  });
});
