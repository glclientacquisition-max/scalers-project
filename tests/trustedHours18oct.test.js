// BRAIN_TRUSTED_HOURS (off unless exactly 'on'). Source calls:
//   - Aris prod HD_49d726c3dc9b (2026-10-18 13:14 EAT, Sunday, release ae8508ea):
//     tests/fixtures/brain-calls/HD_49d726c3dc9b.call.json, tenant
//     tests/fixtures/tenants/aris-prod-18oct.json (phones/emails redacted).
//   - Esga prod HD_dfd531f8b083 (name "Do I need"):
//     tests/fixtures/brain-calls/HD_dfd531f8b083.name.json
// Flag off pins what prod did; flag on is the fix.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const FX = require('./fixtures/brain-calls/HD_49d726c3dc9b.call.json');
const NAME_FX = require('./fixtures/brain-calls/HD_dfd531f8b083.name.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const ARIS_SNAPSHOT = require('./fixtures/tenants/aris-prod-18oct.json');
const ARIS = profileFromSnapshot(ARIS_SNAPSHOT);
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const trustedHours = require('../src/conversation/trustedHours');
const { factLine, renderLine, TEMPLATES } = require('../src/conversation/factLine');
const { buildSystemPrompt } = require('../src/prompts');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { spokenQuestionLedger, isNonAnswer } = require('../src/conversation/spokenAnswers');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities, isPlausibleCallerName } = require('../src/conversation/entityExtraction');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const {
  mergeTranscriptReview,
  preferContext,
  callLanguageFromTurns,
  runPostCallTranscriptReview,
  toolFlagsFromBrain,
} = require('../src/conversation/callTranscriptReview');
const { validateCallerInfo, validateServiceRequest } = require('../src/conversation/toolExecution');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] == null) delete process.env[key];
    else process.env[key] = vars[key];
  }
  const restore = () => {
    for (const key of Object.keys(vars)) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}
const OFF = { BRAIN_TRUSTED_HOURS: null };
const ON = { BRAIN_TRUSTED_HOURS: 'on' };

const SUNDAY = new Date('2026-10-18T10:16:24Z'); // Sunday 13:16 EAT
const turnsLive = FX.turns.filter((t) => t.outcome !== 'hold');

function guardTurn(n, vars, profile = ARIS) {
  return withEnv(vars, () => {
    const callerTurns = [];
    for (const t of turnsLive) {
      callerTurns.push(t.caller);
      if (t.turn !== n) continue;
      const dropReasons = [];
      const state = { caller: { name: 'Alvin Yegon', nameConfirmed: true }, conversation: { turnCount: t.turn } };
      const out = guardSpokenReply(t.modelOutput, {
        callerTurns: [...callerTurns],
        profile,
        language: t.language,
        state,
        now: new Date(t.at),
        dropReasons,
      });
      return { out, dropReasons, state };
    }
    throw new Error(`no turn ${n}`);
  });
}

function spokenTurns() {
  const rows = [{ speaker: 'agent', text: FX.greeting }];
  for (const t of turnsLive) {
    rows.push({ speaker: 'caller', text: t.caller });
    if (t.spoken) rows.push({ speaker: 'agent', text: t.spoken });
  }
  return rows;
}

function replayState(vars) {
  return withEnv(vars, () => {
    let state = createBrainState(ARIS);
    for (const t of turnsLive) {
      const entities = extractConversationEntities(t.caller, { profile: ARIS, intent: state.intent, state });
      state = observeCallerTurn(state, { text: t.caller, profile: ARIS, entities });
      if (FX.nameConfirmed.atTurn === t.turn) {
        state.caller = { ...state.caller, name: FX.nameConfirmed.name, nameConfirmed: true };
      }
    }
    return state;
  });
}

describe('HD_49d726c3dc9b fixture', () => {
  it('is the prod call: Sunday 13:14 EAT, Monday 09:30-18:00 on file, owner FAQ says closed Monday', () => {
    assert.equal(FX.callSid, 'HD_49d726c3dc9b');
    assert.equal(trustedHours.nairobiDays(new Date(FX.startedAt)).today, 'sun');
    assert.deepEqual(ARIS.hoursSchedule.days.mon, { open: '09:30', close: '18:00' });
    assert.ok(ARIS.faqs.some((row) => /closed on Monday/.test(row.answer)));
    assert.equal(turnsLive.find((t) => t.turn === 8).spoken.startsWith('Tomorrow is Monday and we will be closed.'), true);
  });
});

describe('(3) day and hours answers', () => {
  it('flag off: the guard does what prod did (closed claim kept, correct hours dropped)', () => {
    const t8 = guardTurn(8, OFF);
    assert.match(t8.out, /^Tomorrow is Monday and we will be closed\./);
    for (const n of [9, 10, 12]) {
      const t = guardTurn(n, OFF);
      assert.match(t.out, /^I don't have that on file\./, `t${n}`);
      assert.deepEqual(t.dropReasons, ['unsaid_number']);
    }
  });

  it('flag on: the contradicting closed claim becomes the Monday hours_on line', () => {
    const t8 = guardTurn(8, ON);
    assert.deepEqual(t8.dropReasons, ['hours_contradiction']);
    assert.match(t8.out, /^Tomorrow, Monday, we're open from 9:30 AM to 6 PM\./);
    assert.doesNotMatch(t8.out, /closed/i);
    const line = t8.state.conversation.pendingBrainLines[0];
    assert.equal(line.template, 'hours_on');
    assert.deepEqual(line.slots, { day: 'mon', status: 'open', relative: 'tomorrow', open: '09:30', close: '18:00' });
  });

  it('flag on: "Tuesday at what time" and its follow-ups get the Tuesday hours_on line, not "not on file"', () => {
    // Which number sentences pass stays Voice's rule (unsaid_number is
    // Voice's fix); Brain fills the grounded-hours slot with the file line.
    for (const n of [9, 10, 12]) {
      const t = guardTurn(n, ON);
      assert.deepEqual(t.dropReasons, ['unsaid_number'], `t${n}`);
      assert.match(t.out, /^On Tuesday we're open from 9:30 AM to 6 PM\./, `t${n}`);
      assert.doesNotMatch(t.out, /on file/, `t${n}`);
    }
  });

  it('flag on: wrong hours for the asked day are replaced by the file line', () => {
    const out = withEnv(ON, () =>
      guardSpokenReply('On Tuesday we open at 8 AM. Anything else?', {
        callerTurns: ['Tuesday at what time will you be open?'],
        profile: ARIS,
        language: 'en',
        state: { conversation: { turnCount: 3 } },
        now: SUNDAY,
      })
    );
    assert.equal(out, "On Tuesday we're open from 9:30 AM to 6 PM. Anything else?");
  });

  it('flag on: closed only when the grid says closed', () => {
    const sat = withEnv(ON, () =>
      guardSpokenReply('Yes, we are open on Saturday from 9:30 AM.', {
        callerTurns: ['Are you open on Saturday?'],
        profile: ARIS,
        language: 'en',
        state: { conversation: { turnCount: 2 } },
        now: SUNDAY,
      })
    );
    assert.equal(sat, "On Saturday we're closed.");
    const mon = withEnv(ON, () =>
      guardSpokenReply('No, we are closed on Monday.', {
        callerTurns: ['Are you open on Monday?'],
        profile: ARIS,
        language: 'en',
        state: { conversation: { turnCount: 2 } },
        now: SUNDAY,
      })
    );
    assert.equal(mon, "Tomorrow, Monday, we're open from 9:30 AM to 6 PM.");
  });

  it('flag on: no hours on file is "I\'ll have the team confirm." in en, sw, sheng', () => {
    const bare = { ...ARIS, hoursSchedule: null, businessHours: '' };
    const said = (lang, caller) =>
      withEnv(ON, () =>
        guardSpokenReply('We are open tomorrow from 8 AM to 5 PM.', {
          callerTurns: [caller],
          profile: bare,
          language: lang,
          state: { conversation: { turnCount: 2 } },
          now: SUNDAY,
        })
      );
    assert.equal(said('en', 'Will you be open tomorrow?'), "I'll have the team confirm.");
    assert.equal(said('sw', 'Kesho mko wazi?'), 'Nitaomba timu ithibitishe.');
    assert.equal(said('sheng', 'Kesho mko wazi?'), 'Nitaambia team iconfirm.');
  });

  it('flag on: the hours_on line once per caller turn across streamed sentences', () => {
    withEnv(ON, () => {
      const state = { conversation: { turnCount: 8 } };
      const ctx = () => ({ callerTurns: ['But maybe I can pass by tomorrow.'], profile: ARIS, language: 'en', state, now: SUNDAY });
      const a = guardSpokenReply('Tomorrow is Monday and we will be closed.', ctx());
      const b = guardSpokenReply('But we are closed tomorrow.', ctx());
      assert.match(a, /^Tomorrow, Monday, we're open/);
      assert.doesNotMatch(b, /we're open/);
    });
  });

  it('today and tomorrow are Nairobi days, not UTC days', () => {
    const lateUtc = new Date('2026-10-18T22:30:00Z'); // Monday 01:30 EAT
    assert.deepEqual(
      { today: trustedHours.nairobiDays(lateUtc).today, tomorrow: trustedHours.nairobiDays(lateUtc).tomorrow },
      { today: 'mon', tomorrow: 'tue' }
    );
    assert.deepEqual(trustedHours.daysNamed('tomorrow', lateUtc), ['tue']);
  });

  it('hours_on and hours_unknown are fact-line templates with Brain fallbacks', () => {
    assert.ok(TEMPLATES.hours_on && TEMPLATES.hours_unknown);
    assert.equal(factLine('hours_on', { status: 'open' }), null);
    const sw = renderLine(factLine('hours_on', { day: 'tue', status: 'open', open: '09:30', close: '18:00' }, { lang: 'sw' }));
    assert.equal(sw, 'Jumanne tuko wazi saa tatu na nusu asubuhi hadi saa kumi na mbili jioni.');
    const sheng = renderLine(factLine('hours_on', { day: 'sat', status: 'closed' }, { lang: 'sheng' }));
    assert.equal(sheng, 'Jumamosi tuko closed.');
    assert.equal(renderLine(factLine('hours_unknown', {}, { lang: 'en' })), "I'll have the team confirm.");
  });

  it('prompt: flag off unchanged; flag on adds Nairobi today/tomorrow, both days, and drops the conflicting FAQ from live truth', () => {
    const off = withEnv(OFF, () => buildSystemPrompt(ARIS, { now: SUNDAY }));
    assert.doesNotMatch(off, /TODAY IN KENYA/);
    const on = withEnv(ON, () => buildSystemPrompt(ARIS, { now: SUNDAY }));
    assert.match(on, /TODAY IN KENYA: Sunday 18 October\. TOMORROW: Monday 19 October\./);
    assert.match(on, /today Sunday: closed; tomorrow Monday: open 9:30 AM to 6 PM\./);
    assert.match(on, /IGNORE these FAQ answers about open days; they contradict the hours grid: "Are you open on Monday\?"/);
    const liveOff = withEnv(OFF, () => buildLiveGroundTruth(ARIS));
    const liveOn = withEnv(ON, () => buildLiveGroundTruth(ARIS));
    assert.match(liveOff, /Are you open on Monday\?/);
    assert.doesNotMatch(liveOn, /Are you open on Monday\?/);
    assert.match(liveOn, /Do you have a website\?/);
  });
});

describe('(4) honest summary', () => {
  it('ledger: flag off misses the hours question; flag on lists it as unanswered (a refused answer is no answer)', () => {
    const off = withEnv(OFF, () => spokenQuestionLedger(spokenTurns()));
    assert.deepEqual(off.unanswered, []);
    const on = withEnv(ON, () => spokenQuestionLedger(spokenTurns()));
    assert.deepEqual(on.unanswered, ['hours']);
    assert.deepEqual(on.answered, ['Do you deliver?', 'Uh, which items do you deal with?']);
  });

  it('ledger: a spoken file-hours answer counts; "I\'ll have the team confirm." does not', () => {
    const rows = [
      { speaker: 'caller', text: 'Uh, Tuesday at what time will you be open?' },
      { speaker: 'agent', text: "I'll have the team confirm." },
    ];
    withEnv(ON, () => {
      assert.equal(isNonAnswer("I'll have the team confirm."), true);
      assert.deepEqual(spokenQuestionLedger(rows).unanswered, ['hours']);
      rows.push({ speaker: 'agent', text: "On Tuesday we're open from 9:30 AM to 6 PM." });
      assert.deepEqual(spokenQuestionLedger(rows).answered, ['hours']);
    });
  });

  it('goal: flag off (D199 on) is a fragment; flag on is the hours ask, never "Bye"', () => {
    const offD = replayState({ BRAIN_TRUSTED_HOURS: null, BRAIN_CALL_FIXES_D199: 'on' });
    assert.equal(offD.goal.description, 'at, at what time');
    const offBoth = replayState({ BRAIN_TRUSTED_HOURS: null, BRAIN_CALL_FIXES_D199: null });
    assert.equal(offBoth.goal.description, 'Bye');
    for (const d199 of [null, 'on']) {
      const vars = { BRAIN_TRUSTED_HOURS: 'on', BRAIN_CALL_FIXES_D199: d199 };
      const state = replayState(vars);
      assert.equal(state.goal.description, 'opening hours on Tuesday', `D199 ${d199}`);
      const summary = withEnv(vars, () => deriveCallSummary({ brainState: state }));
      assert.equal(summary.reason, 'Alvin Yegon asked about opening hours on Tuesday.');
    }
  });

  it('card: "Hours were answered." only when the hours were answered', () => {
    const rv = FX.stored.summary.owner_review;
    const review = { reason: rv.reason, want: rv.want, done: rv.done, next: rv.next, mood: rv.mood, primary_intent: rv.primary_intent, confidence: rv.confidence };
    const run = (vars) =>
      withEnv(vars, () => {
        const state = replayState(vars);
        const derived = deriveCallResolution({ brainState: state, spokenTurns: spokenTurns() });
        return mergeTranscriptReview({
          derived,
          summary: deriveCallSummary({ brainState: state }),
          toolFlags: toolFlagsFromBrain(state),
          review,
          callerTurns: turnsLive.map((t) => t.caller),
        });
      });
    const off = run({ BRAIN_TRUSTED_HOURS: null, BRAIN_CALL_FIXES_D199: 'on' });
    assert.equal(off.next, 'Hours were answered.');
    const on = run({ BRAIN_TRUSTED_HOURS: 'on', BRAIN_CALL_FIXES_D199: 'on' });
    assert.equal(on.next, 'Call them back with the hours.');
    assert.equal(on.reason, 'Alvin Yegon asked about opening hours on Tuesday.');
  });

  it('a second, empty hangup session does not replace the real snapshot (flag on)', () => {
    const live = {
      callSid: FX.callSid,
      summary: { primaryIntent: 'general_enquiry', reason: 'Alvin Yegon asked about opening hours on Tuesday.', language: 'en', callerName: 'Alvin Yegon' },
      derived: { primaryIntent: 'general_enquiry', resolution: 'unresolved' },
      toolFlags: { callerName: 'Alvin Yegon' },
    };
    const empty = { callSid: FX.callSid, summary: { text: 'Call completed.', reason: '', language: 'unknown', primaryIntent: null }, derived: { primaryIntent: null }, toolFlags: {} };
    assert.equal(withEnv(OFF, () => preferContext(live, empty)).summary.text, 'Call completed.');
    const on = withEnv(ON, () => preferContext(live, empty));
    assert.equal(on.summary.reason, live.summary.reason);
    assert.equal(on.derived.primaryIntent, 'general_enquiry');
  });

  it('language comes from the caller turns (flag on writes it on the reviewed summary)', async () => {
    assert.equal(callLanguageFromTurns(turnsLive.map((t) => t.caller)), 'en');
    assert.equal(callLanguageFromTurns(['Habari, mko wapi?', 'Nataka kujua bei', 'Sawa asante']), 'sw');
    assert.equal(callLanguageFromTurns([]), null);
    const turns = spokenTurns();
    const review = JSON.stringify({ reason: 'Alvin Yegon asked about Bye.', want: 'Alvin Yegon asked about Bye.', done: 'None.', next: 'Hours were answered.', mood: 'calm', primary_intent: 'general_enquiry', confidence: 0.95, needs_human: false });
    const runReview = (vars) =>
      withEnv({ ...vars, POST_CALL_GEMINI_REVIEW: 'on' }, async () => {
        let saved = null;
        await runPostCallTranscriptReview(
          { callSid: FX.callSid, turns, summary: { text: 'Call completed.', language: 'unknown' }, derived: { resolution: 'unknown', unansweredQuestions: ['hours'] }, toolFlags: {} },
          { generateText: async () => review, save: async (row) => { saved = row; }, recordStatus: async () => {}, saveFacts: async () => {}, waitMs: 0, retryMs: 0, delay: async () => {} }
        );
        return saved;
      });
    const off = await runReview(OFF);
    assert.equal(off?.merged?.language, undefined);
    const on = await runReview(ON);
    assert.equal(on.merged.language, 'en');
    assert.equal(on.merged.next, 'Call them back with the hours.');
  });
});

describe('(5) name gate', () => {
  const t11 = NAME_FX.turns.find((t) => t.turn === 11);

  it('fixture: the model saved "Do I need" from "Do I need?"', () => {
    assert.equal(t11.caller, 'Do I need?');
    assert.equal(NAME_FX.stored.summary_name, 'Do I need');
  });

  it('flag off accepts "Do I need" (pinned); flag on rejects it on both tools', () => {
    const parsed = parseGeminiResponse(t11.modelOutput);
    assert.equal(parsed.name, 'Do I need');
    assert.equal(parsed.serviceRequest.name, 'Do I need');
    withEnv(OFF, () => {
      assert.equal(isPlausibleCallerName('Do I need'), true);
      assert.equal(validateCallerInfo({ name: parsed.name, reason: parsed.reason }).value.name, 'Do I need');
      assert.equal(validateServiceRequest(parsed.serviceRequest, {}).value.name, 'Do I need');
    });
    withEnv(ON, () => {
      assert.equal(isPlausibleCallerName('Do I need'), false);
      assert.equal(validateCallerInfo({ name: parsed.name, reason: parsed.reason }).value.name, '');
      const row = validateServiceRequest(parsed.serviceRequest, {});
      assert.equal(row.valid, true);
      assert.equal(row.value.name, '');
      const hold = validateServiceRequest({ type: 'hold', name: 'Do I need', item: 'JK copy paper', whenText: 'tomorrow' }, {});
      assert.deepEqual(hold.missingSlots, ['name']);
    });
  });

  it('flag on: question and function-word spans are not names; real names still are', () => {
    withEnv(ON, () => {
      for (const junk of ['Do I need', 'What do you', 'Can you', 'Nataka nini', 'Is it', 'Where are']) {
        assert.equal(isPlausibleCallerName(junk), false, junk);
      }
      for (const name of ['Alvin Yegon', 'Will Smith', 'May Wanjiru', 'Grace', 'Joy Atieno', 'Mary-Anne', 'Don']) {
        assert.equal(isPlausibleCallerName(name), true, name);
      }
    });
  });
});

describe('(3) prose hours only', () => {
  it('flag on: prose hours ("8 AM to 6 PM", no grid) are not judged; the old path keeps them', () => {
    const profile = { businessHours: '8 AM to 6 PM' };
    const run = (vars) =>
      withEnv(vars, () =>
        guardSpokenReply("We're open today.", { callerTurns: ['Are you open?'], profile, language: 'en', state: { conversation: { turnCount: 1 } }, now: SUNDAY })
      );
    assert.equal(run(ON), run(OFF));
    assert.match(run(ON), /open today/i);
  });
});
