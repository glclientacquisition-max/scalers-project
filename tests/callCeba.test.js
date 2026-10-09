// HD_ceba9d9b3f37 (staging, 2026-10-09 12:59 EAT, build ccdab29b) and
// HD_1677e57f73f9 (13:04 EAT). Voice fixes:
//  1) no speech, outage or owner alert once the caller hung up;
//  2) every code-spoken line goes into the model history (one helper);
//  3) "still there?" after any turn that ends without the caller speaking,
//     and the file read-out ends on a question;
//  4) a caller final that lands while the model thinks supersedes the stale
//     reply; closing cues go to the close path;
//  5) request_open says the kind once; the read-out is capped.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FIXTURE = require('./fixtures/voice-lane/HD_ceba9d9b3f37.voice.json');
const HD1677 = require('./fixtures/voice-lane/HD_1677e57f73f9.voice.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { planConfirmFileRead } = require('../src/conversation/callFixesD199');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { buildGeminiContents } = require('../src/conversation/geminiVoice');
const { setVoiceRendererForTest } = require('../src/conversation/factLine');
const { callIsOverFrom, speechVerdict, outageHandlingAllowed } = require('../src/speech/callOver');
const { runBrainEndClose } = require('../src/speech/callClose');
const { recordSpokenLine, spokenLineReachedCaller, spokenLineNote } = require('../src/speech/spokenHistory');
const {
  createIdleNudgeController,
  idleNudgeArmPlan,
  idleStatementDelayMs,
  idleNudgeDelayMs,
} = require('../src/speech/idleNudge');
const { shapeFileReadOut, withReadOutQuestion, readOutQuestion } = require('../src/speech/fileReadOut');
const { supersedeDecision, finalHasContent } = require('../src/speech/staleReply');
const { classifyClosingCue, planClosingCue, closingCheckLine, agentAskedYesNo } = require('../src/speech/closingCue');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const NOW = new Date(FIXTURE.startedAt);
const turn = (n) => FIXTURE.turns.find((t) => t.turn === n);

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function callProfile() {
  const card = buildCallerMemoryCard({
    contact: FIXTURE.callerFile.contact,
    openRequests: FIXTURE.callerFile.requests,
    openAppointments: FIXTURE.callerFile.openAppointments,
    now: NOW,
  });
  const profile = profileFromSnapshot(TENANT);
  profile.callerMemory = card;
  profile.openAppointments = FIXTURE.callerFile.openAppointments;
  return profile;
}

/** t1 "My booking, please." -> code name ask; t2 "Yeah." -> name confirmed. */
function replayToConfirm() {
  const profile = callProfile();
  let state = createBrainState(profile);
  let lastAgent = 'Done and Dusted, this is Shy. You can speak in English or Kiswahili. Tukusaidie vipi.';
  for (const n of [1, 2]) {
    const t = turn(n);
    const before = state;
    const entities = extractConversationEntities(t.caller, { profile, intent: 'general_enquiry', state });
    state = observeCallerTurn(state, {
      text: t.caller,
      entities,
      lastAgentText: lastAgent,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      now: NOW,
    });
    if (before?.caller?.nameConfirmed !== true && state?.caller?.nameConfirmed === true) {
      state.caller.nameJustConfirmed = true;
    }
    const gate = planCallerModelTurn(state, { unfinishedDecided: true, profile });
    if (n === 1) {
      assert.equal(gate.runModel, false);
      assert.equal(gate.line, turn(1).canned.text);
      state.caller.fileNameAskSpoken = true;
      lastAgent = gate.line;
    }
  }
  return { state, profile };
}

// ---------------------------------------------------------------- 1) call over

describe('1) HD_ceba t6: nothing is spoken or alerted after the caller hung up', () => {
  it('the fixture: t6 "That\'s all." ran after the hangup and spoke nothing', () => {
    assert.equal(FIXTURE.after.hangupBeforeTurn, 6);
    assert.equal(turn(6).caller, "That's all.");
    assert.equal(turn(6).spoken, undefined);
    assert.equal(FIXTURE.after.falseOutageAlert, true);
  });

  it('a closed socket or a terminal webhook is call over; TTS missing then is not an outage', () => {
    assert.equal(callIsOverFrom({ wsOpen: false }), true);
    assert.equal(callIsOverFrom({ wsOpen: true, terminal: true }), true);
    assert.equal(callIsOverFrom({ wsOpen: true }), false);
    // t6 live: socket closed, TTS session gone.
    assert.equal(speechVerdict({ callOver: true, ttsReady: false }), 'call_over');
    assert.equal(speechVerdict({ callOver: true, ttsReady: false, outageStarted: true }), 'call_over');
    assert.equal(outageHandlingAllowed({ callOver: true }), false);
    // A live call with no TTS is still an outage (unchanged).
    assert.equal(speechVerdict({ callOver: false, ttsReady: false }), 'outage');
    assert.equal(outageHandlingAllowed({ callOver: false }), true);
    assert.equal(speechVerdict({ callOver: false, ttsReady: true }), 'speak');
  });

  it('Brain END after the hangup: no goodbye, no hangup; a hangup during the goodbye is not re-closed', async () => {
    const said = [];
    const hung = [];
    const closed = [];
    const plan = await runBrainEndClose({
      action: 'END',
      language: 'en',
      idle: { close: () => closed.push('idle') },
      isOver: () => true,
      speak: (line) => said.push(line),
      hangup: (r) => hung.push(r),
    });
    assert.equal(plan.close, true);
    assert.equal(plan.callOver, true);
    assert.deepEqual(said, []);
    assert.deepEqual(hung, []);
    assert.deepEqual(closed, ['idle']);

    let over = false;
    const plan2 = await runBrainEndClose({
      action: 'END',
      language: 'en',
      isOver: () => over,
      speak: (line) => {
        said.push(line);
        over = true;
      },
      hangup: (r) => hung.push(r),
    });
    assert.equal(plan2.spoken, true);
    assert.deepEqual(said, ['Thank you. Goodbye.']);
    assert.deepEqual(hung, []);

    // Live call: unchanged.
    const live = [];
    await runBrainEndClose({ action: 'END', language: 'sw', isOver: () => false, speak: (l) => live.push(l), hangup: (r) => live.push(r) });
    assert.deepEqual(live, ['Asante. Kwaheri.', 'end_call']);
  });

  it('server wiring: speakText, the outage handler and a queued turn check callIsOver first', () => {
    const speak = SERVER.slice(SERVER.indexOf('  async function speakText(text, opts = {}) {'));
    const callOverAt = speak.indexOf("speechVerdict({ callOver: callIsOver() }) === 'call_over'");
    const ttsAt = speak.indexOf("return handleSpeechProviderOutage('tts unavailable')");
    assert.ok(callOverAt > 0 && ttsAt > callOverAt, 'speakText returns on call over before any outage path');
    const outage = SERVER.slice(SERVER.indexOf('  async function handleSpeechProviderOutage(reason) {'));
    const guardAt = outage.indexOf('outageHandlingAllowed({ callOver: callIsOver() })');
    const alertAt = outage.indexOf('noteSpeechOutage(');
    assert.ok(guardAt > 0 && alertAt > guardAt, 'the outage handler (clip + owner alert) is guarded');
    assert.match(SERVER, /isOver: callIsOver,/);
    assert.match(
      SERVER,
      /messages\.push\(\{ role: 'user', content: clean \}\);[\s\S]{0,400}if \(callIsOver\(\)\) \{[\s\S]{0,600}turnBusy = false;\s*return;/,
      'a turn that runs after the hangup returns before any speech or model call'
    );
  });
});

// ---------------------------------------------------- 2) spoken lines in history

describe('2) every code-spoken line reaches the model history', () => {
  it('HD_ceba t1-t5: the name ask, the read-out and the service list are in the t5 model contents', () => {
    const messages = [{ role: 'system', content: 'sys' }];
    recordSpokenLine(messages, 'Done and Dusted, this is Shy. Tukusaidie vipi.', { source: 'greeting' });
    messages.push({ role: 'user', content: turn(1).caller });
    recordSpokenLine(messages, turn(1).canned.text, { source: 'file_name_ask' });
    messages.push({ role: 'user', content: turn(2).caller });
    recordSpokenLine(messages, turn(2).canned.text, { source: 'confirm_read' });
    messages.push({ role: 'user', content: turn(4).caller });
    recordSpokenLine(messages, turn(4).speakPacket, { source: 'catalogue' });
    messages.push({ role: 'user', content: turn(5).caller });
    const contents = buildGeminiContents(messages);
    // No unsigned model turns: every code-spoken line is a user-side note.
    assert.ok(contents.every((c) => c.role === 'user'));
    const text = contents.map((c) => c.parts.map((p) => p.text).join(' ')).join('\n');
    assert.match(text, /You already said this to the caller, word for word: "Am I speaking with Alvin\?"/);
    assert.match(text, /word for word: "You have a Carpet Cleaning visit request for today/);
    assert.match(text, /word for word: "We offer Apartment and House Cleaning/);
    assert.match(text, /Okay, thank you\.$/);
    // Order is kept: the read-out comes before the services ask.
    assert.ok(text.indexOf('Carpet Cleaning visit') < text.indexOf('what services do you offer'));
  });

  it('a model reply stays a model turn; a plain local row stays out; a repeat is one row', () => {
    const messages = [
      { role: 'assistant', content: 'Hi.', local: true },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'How can I help?', thoughtSignature: 'sig' },
    ];
    assert.equal(recordSpokenLine(messages, 'Is there anything else I can help you with?', { source: 'closing_check' }), true);
    assert.equal(recordSpokenLine(messages, 'Is there anything else I can help you with?', { source: 'closing_check' }), false);
    assert.equal(recordSpokenLine(messages, '   ', {}), false);
    messages.push({ role: 'user', content: 'No.' });
    const contents = buildGeminiContents(messages);
    assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user']);
    assert.equal(contents[1].parts[0].thoughtSignature, 'sig');
    assert.equal(contents[2].parts[0].text, `${spokenLineNote('Is there anything else I can help you with?')} No.`);
    assert.doesNotMatch(JSON.stringify(contents), /"Hi\."/);
  });

  it('only lines the caller heard are recorded', () => {
    assert.equal(spokenLineReachedCaller({ ok: true }), true);
    assert.equal(spokenLineReachedCaller({ ok: true, cancelled: true }), true);
    for (const r of [null, undefined, { ok: false }, { ok: false, callOver: true }, { ok: false, outage: true }]) {
      assert.equal(spokenLineReachedCaller(r), false);
    }
  });

  it('server wiring: one helper for every direct-to-TTS line', () => {
    assert.match(SERVER, /function noteSpokenLine\(line, source, spoken\) \{\s*if \(spokenLineReachedCaller\(spoken\)\) recordSpokenLine\(messages, line, \{ source \}\);/);
    for (const source of [
      'confirm_read', 'visit_read', 'farewell', 'file_name_ask', 'catalogue', 'speak_slot', 'llm_unavailable',
      'speech_repair', 'coverage_next', 'llm_recovery', 'closing_check',
    ]) {
      assert.ok(SERVER.includes(`'${source}'`), `noteSpokenLine source ${source}`);
    }
    for (const source of ['idle_nudge', 'wait_reprompt', 'outage_line', 'tool_outcome', 'greeting', 'greeting_fallback', 'lookup_sentence']) {
      assert.ok(SERVER.includes(`{ source: '${source}' }`), `recordSpokenLine source ${source}`);
    }
    // No code-spoken line is pushed around the helper any more.
    assert.doesNotMatch(SERVER, /messages\.push\(\{ role: 'assistant', content: [\w.]+, local: true \}\)/);
  });
});

// ------------------------------------------------- 3) idle check-in + read-out ask

describe('3) "still there?" after any turn that ends without the caller speaking', () => {
  it('statements and turn ends arm it, on a shorter delay than questions', () => {
    const q = idleNudgeDelayMs({});
    const st = idleStatementDelayMs({});
    assert.equal(q, 10000);
    assert.equal(st, 7000);
    assert.equal(idleStatementDelayMs({ VOICE_IDLE_STATEMENT_MS: '5000' }), 5000);
    assert.equal(idleStatementDelayMs({ VOICE_IDLE_STATEMENT_MS: '12000', VOICE_IDLE_NUDGE_MS: '8000' }), 8000);
    const base = { heardCaller: true, questionDelayMs: q, statementDelayMs: st };
    assert.deepEqual(idleNudgeArmPlan({ ...base, event: 'line_committed', pendingIsQuestion: true }), { arm: true, delayMs: q, reason: 'question' });
    // HD_ceba t2: the read-out was all statements.
    assert.deepEqual(idleNudgeArmPlan({ ...base, event: 'line_committed', pendingIsQuestion: false }), { arm: true, delayMs: st, reason: 'statement' });
    // HD_ceba t3: "Okay." skipped as noise; the turn ends with nothing said.
    assert.deepEqual(idleNudgeArmPlan({ ...base, event: 'turn_end', armed: false }), { arm: true, delayMs: st, reason: 'turn_end' });
    assert.equal(idleNudgeArmPlan({ ...base, event: 'turn_end', armed: true }).arm, false);
    assert.equal(idleNudgeArmPlan({ ...base, event: 'turn_end', callerPending: true }).arm, false);
    assert.equal(idleNudgeArmPlan({ ...base, event: 'line_committed', isIdleNudge: true }).arm, false);
    assert.equal(idleNudgeArmPlan({ ...base, event: 'line_committed', heardCaller: false }).arm, false);
    assert.equal(idleNudgeArmPlan({ ...base, event: 'turn_end', callEnding: true }).arm, false);
  });

  it('arm({ delayMs }) uses that delay once', async () => {
    const spoken = [];
    const delays = [];
    const idle = createIdleNudgeController({
      delayMs: 10000,
      canFire: () => true,
      speak: () => spoken.push('nudge'),
      setTimeout: (fn, ms) => {
        delays.push(ms);
        return setTimeout(fn, 1);
      },
      clearTimeout,
    });
    idle.arm({ delayMs: 7000 });
    idle.arm();
    assert.deepEqual(delays, [7000, 10000]);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(spoken, ['nudge']);
  });

  it('server wiring: committed lines and every turn end go through the plan', () => {
    assert.match(SERVER, /applyIdleArmPlan\(\{\s*event: 'line_committed',/);
    assert.match(SERVER, /non_substantive[\s\S]{0,400}applyIdleArmPlan\(\{ event: 'turn_end' \}\);\s*return;/);
    assert.match(SERVER, /turnBusy = false;\s*\/\/ Any turn that ends without the caller speaking gets the check-in\.\s*applyIdleArmPlan\(\{ event: 'turn_end' \}\);\s*kickPendingTurn\(\);/);
  });

  it('the read-out ends on a short question in en / sw / sheng', () => {
    assert.equal(readOutQuestion('en'), 'Would you like to change any of these, or is it something else?');
    assert.equal(readOutQuestion('sw'), 'Ungependa kubadilisha yoyote kati ya hizi, au ni jambo lingine?');
    assert.equal(readOutQuestion('sheng'), 'Unataka kubadilisha yoyote, ama ni kitu ingine?');
    assert.equal(withReadOutQuestion('You have a visit.', 'en'), `You have a visit. ${readOutQuestion('en')}`);
    assert.equal(withReadOutQuestion('Want the next one?', 'en'), 'Want the next one?');
  });
});

// ----------------------------------------------------- 5) read-out wording + cap

describe('5) HD_ceba t2 read-out: 2 rows, a count, a question, the kind said once', () => {
  before(() => setVoiceRendererForTest(undefined));

  it('live t2 doubled "enquiry" and read 6 rows + "25 older"', () => {
    const live = turn(2).canned.text;
    assert.match(live, /open enquiry for Water bowl enquiry/);
    assert.match(live, /There are 25 older open items on file too\.$/);
  });

  for (const lang of ['en', 'sw', 'sheng']) {
    it(`flag on (${lang}): confirm read is capped and asks`, () =>
      withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
        const { state } = replayToConfirm();
        assert.equal(state.caller.nameJustConfirmed, true);
        const raw = planConfirmFileRead(state, { language: lang, now: NOW });
        assert.ok(raw, 'Brain plans the confirm read');
        const rows = raw.lines.filter((l) => l.template !== 'more_open').length;
        const total = raw.lines.find((l) => l.template === 'more_open')?.gate?.open_rows;
        const read = shapeFileReadOut(raw, { language: lang, now: NOW });
        assert.deepEqual(read.lines.map((l) => l.template), ['visit_open', 'visit_open', 'more_open']);
        assert.equal(read.kept, 2);
        assert.equal(read.more, total - 2);
        assert.ok(rows > 2);
        assert.ok(read.line.endsWith(readOutQuestion(lang)), read.line);
        assert.doesNotMatch(read.line, /enquiry.*enquiry|older/i);
        if (lang === 'en') {
          assert.match(read.line, /^You have a Carpet Cleaning visit request for today, Friday, at 9 AM, in Kitengela\. You have a Carpet Cleaning \(per room\) visit request for tomorrow, Saturday, at 9 AM, in Kitengela, Grace Apartments\. There are \d+ more open items on file\. Would you like/);
        }
      }));
  }

  it('a file with one visit and one request reads both, no count', () => {
    const read = shapeFileReadOut(
      {
        line: 'x',
        kind: 'confirm_read',
        lines: [
          { template: 'visit_open', lang: 'en', slots: { job: 'Carpet Cleaning', status: 'requested' }, gate: {} },
          { template: 'request_open', lang: 'en', slots: { kind: 'enquiry', item: 'Water bowl enquiry' }, gate: {} },
        ],
      },
      { language: 'en', now: NOW }
    );
    assert.equal(read.line, `You have a Carpet Cleaning visit request. You have an open enquiry about water bowl. ${readOutQuestion('en')}`);
    assert.equal(read.more, 0);
  });

  it('server wiring: confirm and open reads go through shapeFileReadOut', () => {
    assert.match(SERVER, /shapeFileReadOut\(planConfirmFileRead\(brainState/);
    assert.match(SERVER, /visitRead\.kind === 'open_read' \|\| visitRead\.kind === 'confirm_read'/);
  });
});

// ------------------------------------------------- 4) stale reply + closing cues

describe('4) HD_ceba t5: "That\'s all." while thinking supersedes the stale reply', () => {
  it('the fixture order: model asked, then the final queued, then the reply tts', () => {
    const t5 = turn(5);
    assert.equal(t5.caller, 'Okay, thank you.');
    assert.equal(t5.queuedWhileThinking.text, "That's all.");
    const order = t5.order;
    assert.ok(order.indexOf('model') < order.indexOf('turn_end:thinking_queued'));
    assert.ok(order.indexOf('turn_end:thinking_queued') < order.indexOf('tts'));
    // The stale reply re-read the file and the service list.
    assert.match(t5.spoken.join(' '), /Carpet Cleaning requested for today[\s\S]*We offer carpet cleaning/);
  });

  it('supersedes before reply audio; not after, not for a backchannel or an echo', () => {
    const at = { modelPending: true, replyStarted: false, text: "That's all." };
    assert.deepEqual(supersedeDecision(at), { supersede: true, reason: 'closing_cue', cue: 'end' });
    assert.equal(supersedeDecision({ ...at, replyStarted: true }).supersede, false);
    assert.equal(supersedeDecision({ ...at, modelPending: false }).supersede, false);
    assert.equal(supersedeDecision({ ...at, superseded: true }).supersede, false);
    assert.equal(supersedeDecision({ ...at, echo: true }).supersede, false);
    assert.equal(supersedeDecision({ ...at, text: 'Okay.' }).supersede, false);
    assert.equal(supersedeDecision({ ...at, text: 'Mm-hmm.' }).supersede, false);
    assert.deepEqual(supersedeDecision({ ...at, text: 'Actually make it Saturday.' }), { supersede: true, reason: 'content', cue: '' });
    assert.equal(finalHasContent('A-a,'), false);
  });

  it('the superseding words then close the call (Brain END)', () => {
    const state = createBrainState(callProfile());
    state.conversation.answersReceived = ['Okay, thank you.', "That's all."];
    const decision = determineNextBestAction({ state, capabilities: {} });
    assert.equal(decision.action, 'END');
    assert.equal(planClosingCue({ text: "That's all.", brainAction: decision.action }).action, 'none');
  });

  it('server wiring: a final while thinking supersedes like a barge, labelled superseded', () => {
    assert.match(SERVER, /caller final queued while thinking[\s\S]{0,80}\);\s*supersedeStaleReply\(text, 'thinking_queued'\);/);
    assert.match(SERVER, /supersedeStaleReply\(text, 'flush_while_busy'\);\s*pendingUtterance =/);
    assert.match(SERVER, /flight\.superseded = true;[\s\S]{0,200}bargeInActive = true;/);
    assert.match(SERVER, /replyStarted: \(\) => firstSpokenChunk/);
    assert.match(SERVER, /return supersededTurnTiming && supersededTurnTiming === timing \? 'superseded' : 'barge_in';/);
  });
});

describe('4) closing cues go to the close path', () => {
  it('end cues, thanks, and non-cues', () => {
    for (const t of ["That's all.", 'Sawa, ni hayo tu. Baadaye basi.', 'hiyo tu', 'Thanks, bye.', 'Okay, that is all.', 'Kwaheri.', 'Asante, hiyo tu.']) {
      assert.equal(classifyClosingCue(t).cue, 'end', t);
    }
    for (const t of ['Okay, thank you.', 'Asante sana.', 'asante', 'No, thank you.']) {
      assert.equal(classifyClosingCue(t).cue, 'soft', t);
    }
    for (const t of ['Thank you, what about the price?', 'Okay.', 'Baadaye.', 'Hakuna kitu.', 'Natafakari.', 'I need a cleaner tomorrow.']) {
      assert.equal(classifyClosingCue(t).cue === 'end' || classifyClosingCue(t).cue === 'soft', false, t);
    }
  });

  it('HD_ceba t5 "Okay, thank you." after "Which one do you need?": one "anything else?"', () => {
    const plan = planClosingCue({ text: 'Okay, thank you.', brainAction: 'ANSWER', lastAgentText: turn(4).speakPacket, language: 'en' });
    assert.deepEqual(plan, { action: 'check', cue: 'soft', line: 'Is there anything else I can help you with?', reason: 'thanks' });
    assert.equal(planClosingCue({ text: 'No.', closingCheckAsked: true }).action, 'end');
    assert.equal(planClosingCue({ text: 'Asante.', closingCheckAsked: true }).action, 'end');
    assert.equal(planClosingCue({ text: 'Yes, I need a quote.', closingCheckAsked: true }).action, 'none');
    assert.equal(closingCheckLine('sw'), 'Kuna kingine naweza kukusaidia nacho?');
    assert.equal(closingCheckLine('sheng'), 'Kuna kitu ingine naweza kusaidia?');
  });

  it('a thanks after a yes/no question is left to the turn ("thank you" may be yes)', () => {
    assert.equal(agentAskedYesNo('Shall I book it for Saturday?'), true);
    assert.equal(agentAskedYesNo('Ungependa nikuwekee Jumamosi?'), true);
    assert.equal(agentAskedYesNo('Which one do you need?'), false);
    assert.equal(agentAskedYesNo(readOutQuestion('en')), false);
    assert.equal(planClosingCue({ text: 'Okay, thank you.', lastAgentText: 'Shall I book it for Saturday?' }).action, 'none');
  });

  it('HD_1677 t32 "Sawa, ni hayo tu. Baadaye basi.": Brain missed it, Voice closes', () => {
    const t32 = HD1677.turns.find((t) => t.turn === 32);
    assert.equal(t32.caller, 'Sawa, ni hayo tu. Baadaye basi.');
    const state = createBrainState(callProfile());
    state.conversation.answersReceived = [t32.caller];
    const brain = determineNextBestAction({ state, capabilities: {} });
    assert.notEqual(brain.action, 'END');
    assert.deepEqual(planClosingCue({ text: t32.caller, brainAction: brain.action, language: 'sw' }), { action: 'end', cue: 'end', reason: 'closing_cue' });
    // No other HD_1677 caller turn is a close.
    for (const t of HD1677.turns.filter((x) => x.caller && x.turn < 32)) {
      assert.notEqual(planClosingCue({ text: t.caller, brainAction: 'ANSWER' }).action, 'end', t.caller);
    }
  });

  it('server wiring: Voice END override and the closing check line', () => {
    assert.match(SERVER, /const closingCue = planClosingCue\(\{\s*text: clean,\s*brainAction: nextBestAction\.action,/);
    assert.match(SERVER, /if \(closingCue\.action === 'end'\) \{\s*nextBestAction = \{\s*action: 'END',/);
    assert.match(SERVER, /closingCue\.action === 'check'[\s\S]{0,600}noteSpokenLine\(closingCue\.line, 'closing_check'/);
  });
});

after(() => setVoiceRendererForTest(undefined));
