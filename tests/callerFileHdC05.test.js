const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const HD39_T1 = 'Mm-hm. Namna gani, Shy? Nilikuwa nataka kujua.';
const HD39_T2 = 'Nya, unaongea na Alvin?';
const HD39_T3 = 'Eeh, nilikuwa nataka kujua, ni services gani mna- mna-offer?';

describe('HD_39c40ec3ad1f caller file', () => {
  it('does not stamp an unfinished stem that ends on kujua as the goal', () => {
    assert.equal(callerGoalText(HD39_T1), '');
    assert.equal(callerGoalText('Nilikuwa nataka kujua'), '');
    assert.equal(callerGoalText('nilikuwa nataka'), '');
    assert.equal(callerGoalText('nataka kujua'), '');
    assert.equal(callerGoalText('Nilikuwa nauliza'), '');
    assert.equal(callerGoalText('I wanted to know'), '');
    assert.equal(callerGoalText('I wanted to know…'), '');
    assert.equal(callerGoalText('I wanted to know about'), '');
    assert.equal(callerGoalText('Nilikuwa nataka kujua kuhusu'), '');
    assert.equal(callerGoalText('Nilikuwa nataka kujua bei'), 'bei');

    const state = say(createBrainState(profile), HD39_T1);
    assert.equal(state.goal.description, null);
    const summary = deriveCallSummary({ brainState: state });
    assert.doesNotMatch(summary.text, /Goal:/);
    assert.doesNotMatch(summary.text, /Nilikuwa nataka kujua/);
    assert.doesNotMatch(summary.reason, /Nilikuwa/);

    const forward = classifyFirstForwardAcceptance({
      durationSeconds: 51,
      greetingPlayed: true,
      hasStt: true,
      firstCallerTurn: HD39_T1,
    });
    assert.equal(forward.first_turn, HD39_T1);
    assert.notEqual(forward.bucket, 'first_turn_goal');
    assert.equal(forward.judge, false);

    const flagged = observeCallerTurn(createBrainState(), {
      text: 'I need carpet cleaning tomorrow',
      unfinished: true,
    });
    assert.equal(flagged.goal.description, null);
  });

  it('binds Nya and Yeah after the pack name ask, and not a different name', () => {
    const nya = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      HD39_T2,
      {},
      {
        pendingFileName: 'Alvin',
        lastAgentText: 'Am I speaking with Alvin?',
      }
    );
    assert.equal(nya.name, 'Alvin');
    assert.equal(nya.nameConfirmed, true);

    const yeah = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Yeah, unaongea na Alvin?',
      {},
      {
        pendingFileName: 'Alvin',
        lastAgentText: 'Je, naongea na Alvin?',
      }
    );
    assert.equal(yeah.nameConfirmed, true);

    const nia = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Nia, unaongea na Alvin?',
      {},
      {
        pendingFileName: 'Alvin',
        lastAgentText: 'Je, naongea na Alvin?',
      }
    );
    assert.equal(nia.name, 'Alvin');
    assert.equal(nia.nameConfirmed, true);

    const niaBare = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Nia unaongea na Alvin',
      {},
      {
        pendingFileName: 'Alvin',
        lastAgentText: 'Je, naongea na Alvin?',
      }
    );
    assert.equal(niaBare.nameConfirmed, true);

    let state = say(createBrainState(profile), HD39_T1);
    state = say(state, HD39_T2, { lastAgentText: 'Am I speaking with Alvin?' });
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);
    assert.equal(state.caller.boundRole, 'primary');

    const pack = say(createBrainState(profile), 'Nia, unaongea na Alvin?', {
      lastAgentText: 'Je, naongea na Alvin?',
    });
    assert.equal(pack.caller.name, 'Alvin');
    assert.equal(pack.caller.nameConfirmed, true);
    assert.equal(pack.caller.boundRole, 'primary');
    assert.equal(pack.goal.description, null);

    const other = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Nya, unaongea na Brian?',
      {},
      {
        fileNameJustAsked: true,
        pendingFileName: 'Alvin',
        lastAgentText: 'Am I speaking with Alvin?',
      }
    );
    assert.equal(other.nameConfirmed, false);

    const early = applyCallerNameConfirmation(
      { caller: { nameConfirmed: false }, entities: {} },
      'Nya',
      {},
      { pendingFileName: 'Alvin' }
    );
    assert.equal(early.nameConfirmed, false);
  });

  it('keeps the services ask as the goal after bind, not the opening stem', () => {
    let state = say(createBrainState(profile), HD39_T1);
    state = say(state, HD39_T2, { lastAgentText: 'Am I speaking with Alvin?' });
    state = say(state, HD39_T3);
    assert.equal(state.caller.nameConfirmed, true);
    assert.match(state.goal.description || '', /services/i);
    assert.doesNotMatch(state.goal.description || '', /Nilikuwa nataka kujua/);
    assert.doesNotMatch(state.goal.description || '', /Namna gani/);

    const summary = deriveCallSummary({ brainState: state });
    assert.match(summary.text, /Goal:.*services/i);
    assert.doesNotMatch(summary.text, /Nilikuwa nataka kujua/);
    assert.match(summary.text, new RegExp(`Intent:\\s*${summary.primaryIntent}`));
  });

  it('writes hangup intent from deriveCallSummary under one summary lock', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /const primaryIntent = summary\.primaryIntent/);
    assert.match(server, /withSummaryWriteLock\(callSid/);
    assert.doesNotMatch(
      server,
      /primaryIntent:\s*derived\.primaryIntent\s*\|\|\s*summary\.primaryIntent/
    );
  });
});
