const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  observeCallerTurn,
} = require('../src/conversation/brainState');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { classifyFirstForwardAcceptance } = require('../src/conversation/firstForwardAcceptance');
const {
  applyCallerNameConfirmation,
  callerGoalText,
} = require('../src/conversation/entityExtraction');
const { guardSpokenReply } = require('../src/conversation/speechGuard');

const TURNS = [
  'Nilikuwa nauliza',
  "Eeh, unaongea na Alvin? Nilikuwa nauliza, I heard something left you didn't like.",
  'I had a request with you.',
  'Like, my previous request.',
  'What else?',
  'Uh, what aboutthe inquiry.',
  'Like, the dishwashing one. Do you remember?',
];

const profile = {
  vertical: 'home_services',
  callerMemory: {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: true,
    alternateNames: ['Nauliza aje', 'Bwana Alvin'],
    openRequests: ['dishwashing enquiry'],
  },
};

function say(state, text, extra = {}) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: 'sw',
    resolvedLanguage: 'sw',
    profile,
    ...extra,
  });
}

describe('HD_c05cdda9684d caller file', () => {
  it('does not promote unfinished Kiswahili as the goal or judged first forward', () => {
    const state = say(createBrainState(profile), TURNS[0]);
    assert.equal(state.goal.description, null);
    assert.equal(callerGoalText(TURNS[0]), '');

    const summary = deriveCallSummary({ brainState: state });
    assert.doesNotMatch(summary.text, /Goal:\s*Nilikuwa nauliza/);
    assert.doesNotMatch(summary.reason, /Nilikuwa nauliza/);

    const forward = classifyFirstForwardAcceptance({
      durationSeconds: 98,
      greetingPlayed: true,
      hasStt: true,
      firstCallerTurn: TURNS[0],
    });
    assert.equal(forward.first_turn, TURNS[0]);
    assert.notEqual(forward.bucket, 'first_turn_goal');
    assert.equal(forward.judge, false);

    const flagged = observeCallerTurn(createBrainState(), {
      text: 'I need carpet cleaning tomorrow',
      unfinished: true,
    });
    assert.equal(flagged.goal.description, null);
    const weak = observeCallerTurn(createBrainState(), {
      text: 'I need carpet cleaning tomorrow',
      weakStt: true,
    });
    assert.equal(weak.goal.description, null);
  });

  it('binds Eeh, unaongea na Alvin after the Kiswahili pack ask', () => {
    const direct = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      TURNS[1],
      {},
      {
        fileNameJustAsked: true,
        pendingFileName: 'Alvin',
        lastAgentText: 'Je, naongea na Alvin?',
      }
    );
    assert.equal(direct.name, 'Alvin');
    assert.equal(direct.nameConfirmed, true);

    let state = say(createBrainState(profile), TURNS[0]);
    assert.equal(state.caller.fileNameAsked, null);
    state = say(state, TURNS[1], { lastAgentText: 'Je, naongea na Alvin?' });
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);
    assert.equal(state.caller.boundRole, 'primary');
    assert.equal(state.returning.fileRole, 'primary');

    const other = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Eeh, unaongea na Brian?',
      {},
      {
        fileNameJustAsked: true,
        pendingFileName: 'Alvin',
        lastAgentText: 'Je, naongea na Alvin?',
      }
    );
    assert.equal(other.nameConfirmed, false);
  });

  it('ends the call on a dishwashing or previous-request goal, not the unfinished stem', () => {
    let state = say(createBrainState(profile), TURNS[0]);
    state = say(state, TURNS[1], { lastAgentText: 'Je, naongea na Alvin?' });
    for (const text of TURNS.slice(2)) {
      state = say(state, text);
    }
    assert.equal(state.caller.nameConfirmed, true);
    assert.match(state.goal.description || '', /dishwash/i);
    assert.doesNotMatch(state.goal.description || '', /Nilikuwa nauliza/);

    const summary = deriveCallSummary({ brainState: state });
    assert.match(summary.text, /Goal:.*dishwash/i);
    assert.doesNotMatch(summary.text, /Goal:\s*Nilikuwa nauliza/);
    assert.match(summary.reason, /dishwash/i);
    assert.doesNotMatch(summary.reason, /Nilikuwa nauliza/);
    assert.doesNotMatch(summary.reason, /\?\./);
  });

  it('drops a file-name vocative and open rows before bind', () => {
    const leaked = guardSpokenReply(
      'Yes, Alvin. You have two open carpet cleaning requests.',
      {
        state: {
          caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
          returning: { fileOwnerName: 'Alvin' },
        },
      }
    );
    assert.doesNotMatch(leaked, /Alvin/);
    assert.doesNotMatch(leaked, /open/);
    assert.match(leaked, /confirm who I am speaking with/i);

    const ask = guardSpokenReply('Je, naongea na Alvin?', {
      state: {
        caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
        returning: { fileOwnerName: 'Alvin' },
      },
    });
    assert.equal(ask, 'Je, naongea na Alvin?');
  });
});
