// VOICE_BARE_GREETING_REPLY: a bare Hello / Yes after the greeting always gets
// a short spoken re-invite, never silence.
// Run: node --test tests/bareGreetingReply.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  bareGreetingReplyEnabled,
  bareGreetingLanguage,
  isBareGreetingOrAffirmation,
  bareGreetingReplyLine,
  shouldReinvite,
  MAX_REINVITES,
} = require('../src/speech/bareGreetingReply');
const { decideCallerEvent } = require('../src/speech/turnTaking');
const { createAgentReplayMemory } = require('../src/speech/overlapHold');

const GREETING = 'Hi, this is Shy at Esga Cleaners. How can I help?';

test('switch is off unless set', () => {
  assert.equal(bareGreetingReplyEnabled({}), false);
  assert.equal(bareGreetingReplyEnabled({ VOICE_BARE_GREETING_REPLY: 'off' }), false);
  assert.equal(bareGreetingReplyEnabled({ VOICE_BARE_GREETING_REPLY: 'on' }), true);
  assert.equal(bareGreetingReplyEnabled({ VOICE_BARE_GREETING_REPLY: 'true' }), true);
});

test('bare openers are recognised in English and Kiswahili', () => {
  for (const t of ['Hello', 'Hello?', 'Hello. Hello?', 'Hi', 'Yes', 'Yes.', 'Yeah', 'Yeah?', 'Are you there?']) {
    assert.equal(bareGreetingLanguage(t), 'en', t);
  }
  for (const t of ['Halo', 'Halo?', 'Habari', 'Habari yako?', 'Ndio', 'Ndiyo.', 'Eeh', 'Uko?', 'Uko hapo?']) {
    assert.equal(bareGreetingLanguage(t), 'sw', t);
  }
});

test('real requests are not bare', () => {
  for (const t of [
    'Hello, I need a cleaner',
    'Yes I want to book',
    'Habari, mnafanya usafi wa carpet?',
    'How much is a sofa?',
    'My name is Alvin',
    '',
  ]) {
    assert.equal(isBareGreetingOrAffirmation(t), false, t);
  }
});

test('re-invite line uses the caller language and names agent and business', () => {
  assert.equal(
    bareGreetingReplyLine({ text: 'Hello', agentName: 'Shy', businessName: 'Esga Cleaners' }),
    'Hi, this is Shy at Esga Cleaners. How can I help?'
  );
  assert.equal(
    bareGreetingReplyLine({ text: 'Halo', agentName: 'Shy', businessName: 'Esga Cleaners' }),
    'Sawa, mimi ni Shy wa Esga Cleaners. Nikusaidie aje?'
  );
  assert.equal(
    bareGreetingReplyLine({ text: 'Yes', callLanguage: 'sw', agentName: 'Shy', businessName: 'Aris' }),
    'Sawa, mimi ni Shy wa Aris. Nikusaidie aje?'
  );
  assert.equal(
    bareGreetingReplyLine({ text: 'Hello?', agentName: 'Receptionist', businessName: 'Aris' }),
    'Hi, this is Aris. How can I help?'
  );
  assert.equal(bareGreetingReplyLine({ text: 'Hello' }), 'Hi, how can I help?');
  assert.equal(bareGreetingReplyLine({ text: 'Uko?', count: 1 }), 'Niko hapa. Nikusaidie aje?');
  assert.equal(bareGreetingReplyLine({ text: 'Hello?', count: 1 }), "Yes, I'm here. How can I help?");
  for (const t of ['Hello', 'Hello?', 'Yes', 'Yeah', 'Halo', 'Habari', 'Ndio', 'Eeh', 'Uko?']) {
    const line = bareGreetingReplyLine({ text: t, agentName: 'Shy', businessName: 'Esga' });
    assert.ok(line && line.trim().length > 5, `${t} -> non-empty line`);
  }
});

test('shouldReinvite: only before the first real turn, idle, capped, switch on', () => {
  const base = { enabled: true, text: 'Hello' };
  assert.equal(shouldReinvite(base), true);
  assert.equal(shouldReinvite({ ...base, enabled: false }), false);
  assert.equal(shouldReinvite({ ...base, firstRealTurnDone: true }), false);
  assert.equal(shouldReinvite({ ...base, speaking: true }), false);
  assert.equal(shouldReinvite({ ...base, turnBusy: true }), false);
  assert.equal(shouldReinvite({ ...base, callEnding: true }), false);
  assert.equal(shouldReinvite({ ...base, reinvites: MAX_REINVITES }), false);
  assert.equal(shouldReinvite({ ...base, text: 'Hello I need a cleaner' }), false);
  for (const t of ['Hello', 'Hello?', 'Yes', 'Yeah']) {
    assert.equal(shouldReinvite({ enabled: true, text: t }), true, t);
  }
});

// The bug on main 0340e46e, reproduced with the real modules.
test('root cause: after a cached greeting, hear_again asks for a replay that is empty', () => {
  // playCachedFillerPcm sets lastAgentText but never calls agentReplay.beginSpeech.
  const agentReplay = createAgentReplayMemory();
  const lastAgentText = GREETING;
  for (const t of ['Hello', 'Hello?']) {
    const d = decideCallerEvent({
      text: t,
      phase: 'idle',
      lastAgentText,
      lastAgentAskedQuestion: true,
      replayText: agentReplay.pickReplay(),
    });
    assert.equal(d.kind, 'hear_again', t);
    assert.equal(d.replay, true, `${t}: replay flag set from lastAgentText`);
    assert.equal(agentReplay.pickReplay(), '', `${t}: but the replay line is empty -> silence`);
  }
  // A greeting with no question mark: Yeah / Hello? are ignored backchannels.
  for (const t of ['Yeah', 'Hello?']) {
    const d = decideCallerEvent({
      text: t,
      phase: 'idle',
      lastAgentText: 'Karibu Esga Cleaners.',
      lastAgentAskedQuestion: false,
    });
    assert.equal(d.action === 'ignore' || d.action === 'skip', true, t);
  }
});

test('server wiring: re-invite path, replay fallback and over-greeting drop', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/src\/speech\/bareGreetingReply['"]\)/);
  assert.match(src, /function maybeReinviteBareGreeting\(text, source\)/);
  assert.match(src, /maybeReinviteBareGreeting\(clean, 'turn'\)/);
  // The runCallerTurn intercept sits before shouldSkipCallerTurn.
  const run = src.indexOf("maybeReinviteBareGreeting(clean, 'turn')");
  const skip = src.indexOf('shouldSkipCallerTurn(clean', run);
  assert.ok(run > 0 && skip > run, 're-invite must run before the non-substantive skip');
  // The final handler routes bare openers into the turn merge before the empty replay return.
  const route = src.indexOf("reason: 'bare_greeting' });\n        appendFinalPart(utteranceParts, evt.text);");
  const replay = src.indexOf('if (decision.replay) {', route);
  assert.ok(route > 0 && replay > route, 'bare opener routing must precede the replay branch');
  assert.match(src, /if \(!replay && bareGreetingReplyEnabled\(\) && agentAwaitingReply\(lastAgentText\)\)/);
  assert.match(src, /bare_greeting_over_greeting dropped/);
  assert.match(src, /if \(!isBareGreetingOrAffirmation\(clean\)\) firstRealCallerTurnDone = true;/);
});
