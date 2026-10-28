// VOICE_OWED_CONFIRM_FOLD: fold #617 owed confirm into one receipt line;
// block duplicate create_service_request. Flag off must leave main wiring alone.
delete process.env.FACT_HASH_MODE;
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  owedConfirmFoldEnabled,
  foldOwedIntoReply,
  stripSavedClaimAfterReceipt,
} = require('../src/speech/owedConfirmFold');
const {
  queueToolOutcome,
  takeToolOutcome,
  peekToolOutcome,
} = require('../src/conversation/toolOutcomeQueue');
const {
  findDuplicateServiceRequest,
  noteServiceRequestCreated,
  requestKey,
} = require('../src/conversation/requestDedupe');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

describe('owedConfirmFoldEnabled', () => {
  const prev = process.env.VOICE_OWED_CONFIRM_FOLD;
  afterEach(() => {
    if (prev == null) delete process.env.VOICE_OWED_CONFIRM_FOLD;
    else process.env.VOICE_OWED_CONFIRM_FOLD = prev;
  });

  it('defaults off', () => {
    delete process.env.VOICE_OWED_CONFIRM_FOLD;
    assert.equal(owedConfirmFoldEnabled({}), false);
    assert.equal(owedConfirmFoldEnabled({ VOICE_OWED_CONFIRM_FOLD: 'off' }), false);
  });

  it('turns on for on/1/true/yes', () => {
    assert.equal(owedConfirmFoldEnabled({ VOICE_OWED_CONFIRM_FOLD: 'on' }), true);
    assert.equal(owedConfirmFoldEnabled({ VOICE_OWED_CONFIRM_FOLD: 'TRUE' }), true);
  });
});

describe('foldOwedIntoReply (HD_0daf1d0fd631 / HD_9c1864aacd5f)', () => {
  it('puts the receipt first and drops a second saved claim', () => {
    const folded = foldOwedIntoReply('Okay, I\'ve saved your request.', [
      'Asante, Chris. I\'ve saved your request.',
      'What time works?',
    ]);
    assert.equal(folded.folded, true);
    assert.deepEqual(folded.lines, [
      'Okay, I\'ve saved your request.',
      'What time works?',
    ]);
  });

  it('speaks the Kiswahili receipt once (9e3528d1)', () => {
    const folded = foldOwedIntoReply('Sawa, nimehifadhi ombi lako.', [
      'Asante, Chris. Nimehifadhi ombi lako.',
    ]);
    assert.deepEqual(folded.lines, ['Sawa, nimehifadhi ombi lako.']);
  });

  it('passes reply through when nothing is owed', () => {
    const folded = foldOwedIntoReply('', ['On weekdays we open at 9:30.']);
    assert.equal(folded.folded, false);
    assert.deepEqual(folded.lines, ['On weekdays we open at 9:30.']);
  });
});

describe('stripSavedClaimAfterReceipt', () => {
  it('removes English and Kiswahili saved claims', () => {
    assert.equal(
      stripSavedClaimAfterReceipt('Okay. I\'ve saved your request. What else?'),
      'Okay. What else?'
    );
    assert.equal(stripSavedClaimAfterReceipt('Sawa, nimehifadhi ombi lako.'), '');
  });
});

describe('peekToolOutcome', () => {
  it('does not clear the owed line', () => {
    const state = { conversation: {} };
    queueToolOutcome(state, 'Okay, I\'ve saved your request.');
    assert.equal(peekToolOutcome(state), 'Okay, I\'ve saved your request.');
    assert.equal(peekToolOutcome(state), 'Okay, I\'ve saved your request.');
    assert.equal(takeToolOutcome(state), 'Okay, I\'ve saved your request.');
    assert.equal(peekToolOutcome(state), '');
  });
});

describe('requestDedupe (ee17115a second callback)', () => {
  it('keys by type and item', () => {
    assert.equal(requestKey('callback', 'Hours'), 'callback|hours');
  });

  it('blocks the same type+item inside 60s and allows after the window', () => {
    const state = { conversation: {} };
    const created = { id: 'sr-1', request_type: 'callback', item: 'Hours' };
    noteServiceRequestCreated(state, { type: 'callback', item: 'Hours' }, created, {
      now: 1_000,
    });
    const hit = findDuplicateServiceRequest(
      state,
      { type: 'callback', item: 'Hours' },
      { now: 30_000 }
    );
    assert.equal(hit.id, 'sr-1');
    const miss = findDuplicateServiceRequest(
      state,
      { type: 'callback', item: 'Hours' },
      { now: 70_000 }
    );
    assert.equal(miss, null);
  });
});

describe('server wiring (V1): the owed-outcome preface is gone; the fold flag only gates request bookkeeping', () => {
  it('no take/peek of an owed outcome on the media turn; owedConfirmFoldEnabled still gates noteServiceRequestCreated', () => {
    assert.ok(!SERVER.includes('const owedOutcome = takeToolOutcome(brainState);'));
    assert.ok(!SERVER.includes('speaking queued tool outcome'));
    assert.match(SERVER, /if \(owedConfirmFoldEnabled\(\)\) \{\n\s+noteServiceRequestCreated\(state, request, created\);/);
  });
});
