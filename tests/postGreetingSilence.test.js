// VOICE_POST_GREETING_NUDGE, VOICE_AFTER_HOURS_INVITE_FIRST,
// VOICE_SILENT_CALL_SUMMARY and the always-on STT trace (22 Oct 2026,
// Esga/Aris dead air after the greeting).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  postGreetingNudgeEnabled,
  postGreetingNudgeDelayMs,
  inviteLanguage,
  postGreetingNudgeLine,
  createPostGreetingNudge,
} = require('../src/speech/postGreetingNudge');
const { composeBusinessAssistantIntro, afterHoursInviteFirst } = require('../src/conversation/businessAssistantIntro');
const { deriveCallSummary, silentCallSummaryText } = require('../src/conversation/callSummary');
const { createMemorySink, createVoiceTrace, unturnedSttStage } = require('../src/speech/voiceTrace');

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      seq += 1;
      timers.set(seq, { fn, at: now + ms });
      return seq;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        // let speak promise chains settle
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

describe('post-greeting nudge flag', () => {
  it('only the exact value on enables it', () => {
    assert.equal(postGreetingNudgeEnabled({}), false);
    assert.equal(postGreetingNudgeEnabled({ VOICE_POST_GREETING_NUDGE: 'true' }), false);
    assert.equal(postGreetingNudgeEnabled({ VOICE_POST_GREETING_NUDGE: '1' }), false);
    assert.equal(postGreetingNudgeEnabled({ VOICE_POST_GREETING_NUDGE: 'ON' }), false);
    assert.equal(postGreetingNudgeEnabled({ VOICE_POST_GREETING_NUDGE: 'on' }), true);
  });
  it('defaults to about 6 s and clamps the knob', () => {
    assert.equal(postGreetingNudgeDelayMs({}), 6000);
    assert.equal(postGreetingNudgeDelayMs({ VOICE_POST_GREETING_NUDGE_MS: '8000' }), 8000);
    assert.equal(postGreetingNudgeDelayMs({ VOICE_POST_GREETING_NUDGE_MS: '500' }), 6000);
  });
});

describe('post-greeting nudge language', () => {
  it('follows the invite', () => {
    assert.equal(inviteLanguage('Nikusaidie vipi'), 'sw');
    assert.equal(inviteLanguage('Tukusaidie vipi.'), 'sw');
    assert.equal(inviteLanguage('How can I help?'), 'en');
    assert.equal(inviteLanguage(''), 'en');
    assert.equal(postGreetingNudgeLine({ language: 'sw' }), 'Halo? Nikusaidie vipi?');
    assert.equal(postGreetingNudgeLine({ language: 'en' }), 'Hello? How can I help?');
    assert.notEqual(postGreetingNudgeLine({ language: 'en', count: 1 }), postGreetingNudgeLine({ language: 'en' }));
  });
});

describe('post-greeting nudge controller', () => {
  it('fires after silence, at most twice, then stops', async () => {
    const clock = fakeClock();
    const said = [];
    const n = createPostGreetingNudge({
      delayMs: 6000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      speak: ({ count }) => said.push(count),
    });
    assert.equal(n.armed(), false, 'not armed before the greeting is done');
    n.greetingDone();
    await clock.advance(5999);
    assert.deepEqual(said, []);
    await clock.advance(1);
    assert.deepEqual(said, [0]);
    await clock.advance(6000);
    assert.deepEqual(said, [0, 1]);
    await clock.advance(60000);
    assert.deepEqual(said, [0, 1], 'never more than 2');
    assert.equal(n.armed(), false);
  });

  it('caller speech restarts the window so it never fires mid-speech', async () => {
    const clock = fakeClock();
    const said = [];
    const n = createPostGreetingNudge({
      delayMs: 6000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      speak: ({ count }) => said.push(count),
    });
    n.greetingDone();
    for (let i = 0; i < 5; i += 1) {
      await clock.advance(4000);
      n.noteCallerSpeech();
    }
    assert.deepEqual(said, []);
    await clock.advance(6000);
    assert.deepEqual(said, [0], 'an ignored bare Hello still gets a re-invite after silence');
  });

  it('a processed caller turn stops it for the call', async () => {
    const clock = fakeClock();
    const said = [];
    const n = createPostGreetingNudge({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      speak: () => said.push(1),
    });
    n.greetingDone();
    await clock.advance(2000);
    n.noteCallerTurn();
    await clock.advance(60000);
    assert.deepEqual(said, []);
    assert.equal(n.greetingDone(), false);
  });

  it('does not speak while the agent talks or a turn is busy; retries later', async () => {
    const clock = fakeClock();
    const said = [];
    let busy = true;
    const n = createPostGreetingNudge({
      delayMs: 6000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      canFire: () => !busy,
      speak: () => said.push(1),
    });
    n.greetingDone();
    await clock.advance(6000);
    assert.deepEqual(said, []);
    assert.equal(n.count(), 0, 'a blocked window does not use up a nudge');
    busy = false;
    await clock.advance(6000);
    assert.deepEqual(said, [1]);
  });

  it('barge-in during a nudge does not double-speak: next nudge waits a full window', async () => {
    const clock = fakeClock();
    const said = [];
    let finish;
    const n = createPostGreetingNudge({
      delayMs: 6000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      speak: ({ count }) => {
        said.push(count);
        return new Promise((r) => {
          finish = r;
        });
      },
    });
    n.greetingDone();
    await clock.advance(6000);
    assert.deepEqual(said, [0]);
    // caller barges while the nudge plays: no timer is armed mid-nudge
    assert.equal(n.noteCallerSpeech(), false);
    assert.equal(clock.pending(), 0);
    finish(); // cancelSpeech resolves the line
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await clock.advance(5999);
    assert.deepEqual(said, [0]);
  });

  it('close stops everything', async () => {
    const clock = fakeClock();
    const said = [];
    const n = createPostGreetingNudge({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, speak: () => said.push(1) });
    n.greetingDone();
    n.close();
    await clock.advance(60000);
    assert.deepEqual(said, []);
  });
});

describe('after-hours invite first (VOICE_AFTER_HOURS_INVITE_FIRST)', () => {
  const base = { businessName: 'Esga', agentName: 'Lucy', greetingInvite: 'Nikusaidie vipi', isOpen: false, recordingNotice: true, now: new Date('2026-10-19T16:25:00Z') };
  it('off keeps today\'s closed line', () => {
    const prev = process.env.VOICE_AFTER_HOURS_INVITE_FIRST;
    delete process.env.VOICE_AFTER_HOURS_INVITE_FIRST;
    assert.equal(afterHoursInviteFirst({}), false);
    assert.match(composeBusinessAssistantIntro(base), /We're closed now\. Nikusaidie vipi\.$/);
    if (prev !== undefined) process.env.VOICE_AFTER_HOURS_INVITE_FIRST = prev;
  });
  it('on: serve mode leads with the invite and stays short', () => {
    const line = composeBusinessAssistantIntro({ ...base, afterHoursInviteFirst: true });
    assert.doesNotMatch(line, /closed/i);
    assert.match(line, /This call may be recorded\. Nikusaidie vipi\.$/);
    const old = composeBusinessAssistantIntro({ ...base, afterHoursInviteFirst: false });
    assert.ok(line.split(/\s+/).length < old.split(/\s+/).length);
  });
  it('on: message mode and closure notices are unchanged', () => {
    const msgOn = composeBusinessAssistantIntro({ ...base, afterHoursMode: 'message', afterHoursInviteFirst: true });
    const msgOff = composeBusinessAssistantIntro({ ...base, afterHoursMode: 'message', afterHoursInviteFirst: false });
    assert.equal(msgOn, msgOff);
    const noticeOn = composeBusinessAssistantIntro({ ...base, closureNotice: 'Closed for stocktake today', afterHoursInviteFirst: true });
    const noticeOff = composeBusinessAssistantIntro({ ...base, closureNotice: 'Closed for stocktake today', afterHoursInviteFirst: false });
    assert.equal(noticeOn, noticeOff);
  });
  it('only exact on via env', () => {
    const prev = process.env.VOICE_AFTER_HOURS_INVITE_FIRST;
    process.env.VOICE_AFTER_HOURS_INVITE_FIRST = 'true';
    assert.equal(afterHoursInviteFirst({}), false);
    process.env.VOICE_AFTER_HOURS_INVITE_FIRST = 'on';
    assert.equal(afterHoursInviteFirst({}), true);
    if (prev === undefined) delete process.env.VOICE_AFTER_HOURS_INVITE_FIRST;
    else process.env.VOICE_AFTER_HOURS_INVITE_FIRST = prev;
  });
});

describe('silent-call summary (VOICE_SILENT_CALL_SUMMARY)', () => {
  const greeting = [{ speaker: 'agent', text: 'Good evening, Esga, this is Lucy. Nikusaidie vipi.' }];
  it('off keeps Call completed.', () => {
    const s = deriveCallSummary({ brainState: {}, spokenTurns: greeting, durationSeconds: 10, silentSummary: false });
    assert.equal(s.text, 'Call completed.');
  });
  it('short call with only the greeting: hung up during the greeting', () => {
    const s = deriveCallSummary({ brainState: {}, spokenTurns: greeting, durationSeconds: 10, silentSummary: true });
    assert.match(s.text, /^Caller hung up during or just after the greeting \(10s\)/);
  });
  it('long call with only the greeting: no caller speech after greeting', () => {
    const s = deriveCallSummary({ brainState: {}, spokenTurns: greeting, durationSeconds: 70, silentSummary: true });
    assert.equal(s.text, 'No caller speech after the greeting (70s on the line).');
  });
  it('no turns at all: hung up during the greeting', () => {
    assert.equal(silentCallSummaryText({ spokenTurns: [], durationSeconds: 7, silentSummary: true }), 'Caller hung up during the greeting (7s).');
  });
  it('a caller turn or unknown turns keep the old path', () => {
    assert.equal(silentCallSummaryText({ spokenTurns: [...greeting, { speaker: 'caller', text: 'Hello' }], durationSeconds: 30, silentSummary: true }), '');
    assert.equal(silentCallSummaryText({ spokenTurns: null, durationSeconds: 30, silentSummary: true }), '');
  });
  it('Brain state still wins', () => {
    const s = deriveCallSummary({ brainState: { intent: 'order', caller: { name: 'Chris' } }, spokenTurns: greeting, durationSeconds: 70, silentSummary: true });
    assert.doesNotMatch(s.text, /No caller speech/);
  });
});

describe('STT trace: unturned events reach the call record', () => {
  it('unturnedSttStage is null for an empty buffer', () => {
    assert.equal(unturnedSttStage([]), null);
  });
  it('finishCall keeps STT events that never opened a turn', async () => {
    const sink = createMemorySink();
    const trace = createVoiceTrace({ sink, callId: () => 'HD_test', tenantId: () => null, env: { VOICE_TRACE: 'on' } });
    trace.noteStt({ text: 'Halo', isFinal: false, tokens: [{ text: 'Halo', startMs: 9000, language: 'sw' }] });
    trace.noteStt({ text: 'Halo?', isFinal: true, tokens: [{ text: 'Halo?', startMs: 9000, final: true }] });
    trace.noteCall({ stage: 'stt_lifecycle', kind: 'ready', ms: 120 });
    const record = await trace.finishCall();
    const st = record.stages.find((row) => row.stage === 'stt_unturned');
    assert.ok(st, 'stt_unturned stage present');
    assert.equal(st.finals, 1);
    assert.equal(st.interims, 1);
    assert.equal(st.events[0].startMs, 9000);
    assert.ok(record.stages.some((row) => row.stage === 'stt_lifecycle' && row.kind === 'ready'));
  });
  it('no unturned stage when STT opened a turn', async () => {
    const sink = createMemorySink();
    const trace = createVoiceTrace({ sink, callId: () => 'HD_t2', tenantId: () => null, env: { VOICE_TRACE: 'on' } });
    trace.noteStt({ text: 'Nataka kalamu', isFinal: true, tokens: [] });
    trace.beginTurn({ callerText: 'Nataka kalamu' });
    trace.commitTurn({ outcome: 'ok' });
    const record = await trace.finishCall();
    assert.equal(record.stages.some((row) => row.stage === 'stt_unturned'), false);
  });
});
