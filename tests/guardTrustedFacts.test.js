'use strict';

// VOICE_GUARD_TRUSTED_FACTS (default on): the speech guard trusts the current
// Kenya time and date the prompt gave the model. HD_95e6745c0df1 (prod Aris,
// 17 Oct 2026 15:51 EAT) lost every time answer to unsaid_number.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const facts = require('../src/conversation/trustedFacts');
const { guardSpokenReply, splitSentences } = require('../src/conversation/speechGuard');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { replayCall } = require('../src/speech/replayVoice');
const { buildSystemPrompt } = require('../src/prompts');

const FIXTURE = require(path.join(__dirname, 'fixtures', 'guard-trusted-facts', 'HD_95e6745c0df1.json'));

// 15:51 EAT on 17 Oct 2026 is 12:51 UTC.
const AT_1551 = Date.parse('2026-10-17T12:51:30Z');
const eat = (hh, mm) => Date.parse(`2026-10-17T${String((hh + 21) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}:10Z`);

function withFlag(value, fn) {
  const before = process.env.VOICE_GUARD_TRUSTED_FACTS;
  if (value == null) delete process.env.VOICE_GUARD_TRUSTED_FACTS;
  else process.env.VOICE_GUARD_TRUSTED_FACTS = value;
  try {
    return fn();
  } finally {
    if (before == null) delete process.env.VOICE_GUARD_TRUSTED_FACTS;
    else process.env.VOICE_GUARD_TRUSTED_FACTS = before;
  }
}

function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

function ctxFor(caller, { now = AT_1551, promptClock = null, language = 'en', profile = {}, extra = {} } = {}) {
  return {
    callerTurns: [caller],
    profile,
    toolResults: [],
    capabilities: {},
    state: {
      caller: {},
      conversation: { answersReceived: [], turnCount: 7, ...(promptClock ? { promptClockMs: promptClock } : {}) },
    },
    language,
    allowEmpty: true,
    now,
    ...extra,
  };
}

const guard = (text, caller, opts) => quiet(() => guardSpokenReply(text, ctxFor(caller, opts)));

test('flag reads default on, off by switch', () => {
  assert.equal(facts.trustedFactsEnabled({}), true);
  assert.equal(facts.trustedFactsEnabled({ VOICE_GUARD_TRUSTED_FACTS: 'off' }), false);
  assert.equal(facts.trustedFactsEnabled({ VOICE_GUARD_TRUSTED_FACTS: '0' }), false);
  assert.equal(facts.trustedFactsEnabled({ VOICE_GUARD_TRUSTED_FACTS: 'on' }), true);
});

test('time forms: digits, 12h/24h, English words, Swahili clock with the 6-hour offset', () => {
  const at = (hh, mm) => facts.trustedFactsFor({ now: eat(hh, mm) }).current.forms;
  const f1551 = at(15, 51);
  for (const form of ['15:51', '3:51 PM', '3:51pm', 'three fifty-one PM', 'nine minutes to four',
    'saa tisa na dakika hamsini na moja mchana', 'saa tisa na dakika hamsini na moja alasiri',
    'saa kumi kasoro dakika tisa alasiri', 'saa 9 na dakika 51 alasiri']) {
    assert.ok(f1551.includes(form), `15:51 has "${form}"`);
  }
  assert.ok(at(9, 0).includes('saa tatu kamili asubuhi'), '9 AM is saa tatu');
  assert.ok(at(9, 0).includes('9 AM'));
  assert.ok(at(21, 30).includes('saa tatu na nusu usiku'), '9:30 PM is saa tatu na nusu usiku');
  assert.ok(at(6, 45).includes('saa moja kasorobo asubuhi'), '6:45 AM is saa moja kasorobo');
  assert.ok(at(12, 15).includes('saa sita na robo mchana'), '12:15 is saa sita na robo');
  assert.ok(at(18, 0).includes('saa kumi na mbili kamili jioni'), '6 PM is saa kumi na mbili');
  assert.ok(at(0, 5).includes('saa sita na dakika tano usiku'), '00:05 is saa sita usiku');
});

test('a sentence that states the trusted time passes; a wrong or ETA-shaped one does not', () => {
  const f = facts.trustedFactsFor({ now: AT_1551 });
  const ok = (s, ask = 'time') => facts.sentenceStatesTrustedFact(s, f, { ask });
  assert.equal(ok('Saa hivi ni saa tisa na dakika hamsini na moja alasiri.'), 'time');
  assert.equal(ok('Ni saa tisa na dakika hamsini na moja alasiri (3:51 PM).'), 'time');
  assert.equal(ok("It's 3:51 PM."), 'time');
  assert.equal(ok('It is currently 15:51.', ''), 'time', 'present frame without an ask');
  assert.equal(ok('Ni saa kumi kasoro dakika tisa alasiri.'), 'time');
  assert.equal(ok('It is 4:20 PM.'), '', 'wrong time');
  assert.equal(ok('Ni saa nne na dakika kumi asubuhi.'), '', 'stray digits from two forms');
  assert.equal(ok('Ni saa tisa.'), '', 'partial form');
  assert.equal(ok('The technician will arrive at 3:51 PM.'), '', 'ETA');
  assert.equal(ok('Fundi atafika saa tisa na dakika hamsini na moja alasiri.'), '', 'Swahili ETA');
  assert.equal(ok('It is Ksh 351.'), '', 'price');
  assert.equal(ok('We have 51 pieces in stock now.'), '', 'stock');
  assert.equal(ok('Saa tisa na dakika hamsini na moja.', ''), '', 'no ask and no present frame');
  assert.equal(ok('Leo ni Jumamosi, tarehe 17 Oktoba 2026.', 'date'), 'date');
  assert.equal(ok('Today is Saturday, 18 October 2026.', 'date'), '');
});

test('clock asks: English, Kiswahili, Sheng; hours and visit times are not clock asks', () => {
  const asks = {
    "What's the time?": 'time', 'what time is it': 'time', 'I just want to know the time.': 'time',
    'Do you have the time?': 'time', 'saa ngapi': 'time', 'ni saa ngapi?': 'time', 'saa hizi ni ngapi': 'time',
    'time ni ngapi': 'time', "And it's a ngapi time?": 'time', 'ngapi time sai': 'time', 'Ni time gani saa hii': 'time',
    'time iko aje': 'time', "what's the date": 'date', 'leo ni tarehe ngapi': 'date', 'what day is it': 'date',
    'what time do you open': '', 'saa ngapi mnafungua?': '', 'saa ngapi mtakuja?': '', 'what time can you come tomorrow': '',
    'how much is the ruler': '',
  };
  for (const [text, want] of Object.entries(asks)) assert.equal(facts.callerClockAsk(text), want, text);
});

test('answer language follows how the caller asked', () => {
  assert.equal(facts.askLanguage("And it's a ngapi time?", 'en'), 'sheng');
  assert.equal(facts.askLanguage('saa ngapi sasa', 'en'), 'sw');
  assert.equal(facts.askLanguage("What's the time?", 'sw'), 'en');
  assert.equal(facts.askLanguage('', 'sw'), 'sw');
});

test('prompt and guard share one clock instant; the prompt clock refreshes each minute', () => {
  const prompt = buildSystemPrompt({ businessName: 'Aris Kenya', agentName: 'Lynn' }, { now: AT_1551 });
  assert.match(prompt, /CURRENT TIME IN KENYA: Saturday, 3:51 PM EAT/);
  const promptAt = new Date(AT_1551);
  assert.equal(facts.promptClockStale(promptAt, new Date(AT_1551 + 20 * 1000), {}), false);
  assert.equal(facts.promptClockStale(promptAt, new Date(AT_1551 + 3 * 60 * 1000), {}), true);
  assert.equal(facts.promptClockStale(promptAt, new Date(AT_1551 + 3 * 60 * 1000), { VOICE_GUARD_TRUSTED_FACTS: 'off' }), false);
  // The guard trusts the stamped prompt instant as well as its own now.
  const state = {};
  facts.stampPromptClock(state, promptAt);
  const built = facts.trustedFactsFor({ state, now: AT_1551 + 3 * 60 * 1000 });
  assert.deepEqual(built.instants.map((i) => i.label), ['Saturday, 3:54 PM EAT', 'Saturday, 3:51 PM EAT']);
  assert.equal(facts.trustedFactsFor({ state, now: AT_1551 + 3 * 60 * 1000 }), built, 'built once per turn');
});

test('guard keeps the correct time answer (flag on) and drops it with the flag off', () => {
  const text = 'Saa hivi ni saa tisa na dakika hamsini na moja alasiri. Kuna kitu kingine, Alvin?';
  assert.equal(guard(text, "What's the time?"), text);
  const off = withFlag('off', () => guard(text, "What's the time?"));
  assert.equal(off, 'Kuna kitu kingine, Alvin?', 'old guard deleted the answer');
});

test('a blocked time answer becomes a code fact line in the caller language, never a filler', () => {
  const now = eat(15, 54);
  const wrong = 'Ni saa nne asubuhi. Kuna kitu kingine?';
  assert.equal(guard(wrong, "What's the time?", { now }), "It's 3:54 PM in Kenya now. Kuna kitu kingine?");
  assert.equal(
    guard(wrong, 'saa ngapi sasa?', { now, language: 'en' }),
    'Saa hii ni saa kumi kasoro dakika sita mchana. Kuna kitu kingine?'.replace(
      'saa kumi kasoro dakika sita mchana',
      require('../src/speech/swahiliTime').speakSwClock(15, 54)
    )
  );
  const sheng = guard('Ni saa nne asubuhi.', "And it's a ngapi time?", { now, language: 'en' });
  assert.match(sheng, /^Saa hii ni saa tisa na dakika hamsini na nne mchana, yaani 3:54 PM\.$/);
  assert.doesNotMatch(sheng, /on file/, 'no English not-on-file line to a Sheng caller');
  const date = guard('Leo ni tarehe 3 Machi.', 'leo ni tarehe ngapi?', { now, language: 'sw' });
  assert.equal(date, 'Leo ni Jumamosi, tarehe 17 Oktoba 2026.');
});

test('invented prices, stock, ETAs and clocks are still blocked', () => {
  const now = AT_1551;
  // ETA at exactly the trusted time, even on a time ask.
  assert.doesNotMatch(guard('The technician will arrive at 3:51 PM.', "What's the time? When will he come?", { now }), /3:51/);
  assert.doesNotMatch(guard('Fundi atafika saa tisa na dakika hamsini na moja.', 'saa ngapi atafika?', { now, language: 'sw' }), /tisa/);
  // Price and stock numbers that happen to equal the clock digits.
  assert.doesNotMatch(guard('The ruler is Ksh 351.', 'how much is the ruler?', { now }), /351/);
  assert.doesNotMatch(guard('We have 51 pieces in stock now.', 'how many do you have?', { now }), /51/);
  assert.doesNotMatch(guard('We can deliver in 15 minutes.', 'how fast?', { now }), /15/);
  // A visit clock nobody said.
  assert.doesNotMatch(guard('I can book you for 4 PM.', 'can you book me?', { now }), /4 PM/);
  // Hours on file still need an hours ask (#489).
  const profile = { hoursSchedule: { days: { sat: { open: '09:30', close: '18:00' } } } };
  assert.match(guard('We open at 9:30 AM.', 'what time do you open?', { now, profile }), /9:30 AM/);
});

test('turn 16: everyday Kiswahili is not a place ("hivi karibuni" is not Jaribuni)', () => {
  const kept = 'Ndiyo Alvin, timu yetu itakupigia simu hivi karibuni kukupa bei kamili.';
  assert.equal(guard(kept, 'Call me, ama? Si watanipikia?', { language: 'sw' }), kept);
  for (const line of [
    'Hatuwezi kupeana bei sahihi kwa simu kabla ya kuthibitisha.',
    'Sawa, chukua muda wako.',
    'Tuko salama kabisa.',
    'Timu yetu itawasiliana nawe hivi karibuni.',
  ]) {
    assert.equal(guard(line, 'sawa', { language: 'sw' }), line, line);
  }
  // A real unbound place is still removed.
  assert.doesNotMatch(guard('Tuko Mombasa pia.', 'mko wapi?', { language: 'sw' }), /Mombasa/);
  // Flag off keeps the old binder.
  assert.notEqual(withFlag('off', () => guard(kept, 'Call me, ama? Si watanipikia?', { language: 'sw' })), kept);
});

test('each removal is logged once per turn across the streamed and final passes', () => {
  const lines = [];
  const warn = console.warn;
  console.warn = (line) => lines.push(String(line));
  try {
    const ctx = ctxFor("What's the time?", { now: AT_1551 });
    const wrong = 'Ni saa nne asubuhi.';
    guardSpokenReply(wrong, ctx); // streamed sentence
    guardSpokenReply(`${wrong} Kuna kitu kingine?`, { ...ctx, dropReasons: [] }); // final full reply
    ctx.state.conversation.turnCount += 1;
    guardSpokenReply(wrong, ctx); // next turn logs again
  } finally {
    console.warn = warn;
  }
  const drops = lines.filter((l) => l.includes('[speech-filter] drop reason=unsaid_number'));
  assert.equal(drops.length, 2, drops.join('\n'));
});

// ------------------------------------------------------------- replay

function spokenOf(turn) {
  const polish = turn.stages.find((s) => s.stage === 'transform' && s.name === 'polish');
  if (polish) return String(polish.after || '');
  const model = turn.stages.find((s) => s.stage === 'model' && s.phase === 'output');
  return String(model?.outputText || '').replace(/###TOOL###[\s\S]*?###ENDTOOL###/g, '').trim();
}

const TIME_TURNS = [21, 22, 23, 24, 25];
const STATES_1551 = /saa tisa na dakika hamsini na moja|3:51 PM/;

test('replay HD_95e6745c0df1: flag off reproduces prod, flag on answers every time question', async () => {
  const before = await withFlag('off', () => quiet(() => replayCall(FIXTURE)));
  const after = await quiet(() => replayCall(FIXTURE));
  const byIndex = (r) => Object.fromEntries(r.turns.map((t) => [t.turnIndex, t]));
  const b = byIndex(await before);
  const a = byIndex(after);

  // Before: what prod did.
  assert.match(spokenOf(b[21]), /^I don't have that on file/);
  for (const n of [22, 23, 24, 25]) {
    assert.doesNotMatch(spokenOf(b[n]), STATES_1551, `t${n} before: time removed`);
    const prod = FIXTURE.turns.find((t) => t.turn === n).prod.polish[0];
    assert.equal(prod.reason, 'unsaid_number');
  }
  assert.doesNotMatch(spokenOf(b[16]), /karibuni/);

  // After: every time question carries the time; nothing is removed.
  for (const n of TIME_TURNS) {
    const said = spokenOf(a[n]);
    assert.match(said, STATES_1551, `t${n} after: ${said}`);
    assert.doesNotMatch(said, /on file/, `t${n} no not-on-file line`);
    assert.equal(a[n].stages.filter((s) => s.name === 'polish').length, 0, `t${n} no guard removal`);
  }
  assert.match(spokenOf(a[16]), /hivi karibuni kukupa bei kamili/);
});

test('replay HD_95e6745c0df1 streamed: each sentence chunk keeps the time (prod streams per sentence)', () => {
  for (const turn of FIXTURE.turns.filter((t) => TIME_TURNS.includes(t.turn))) {
    const state = { caller: {}, conversation: { answersReceived: [], turnCount: turn.turn, promptClockMs: Date.parse(FIXTURE.promptClock) } };
    const chunks = splitSentences(turn.model.outputText).map((chunk) =>
      quiet(() =>
        polishSpokenDetail(chunk, {
          callerTurns: [turn.caller],
          profile: { businessName: FIXTURE.businessName, hoursSchedule: FIXTURE.hoursSchedule },
          toolResults: [],
          capabilities: {},
          state,
          language: 'en',
          now: Date.parse(turn.at),
        }).text
      )
    );
    assert.match(chunks[0], STATES_1551, `t${turn.turn} first chunk: ${chunks[0]}`);
    assert.equal(chunks.join(' ').includes('on file'), false);
  }
});

test('replay HD_95e6745c0df1 with a stale model clock: the code line answers in the caller language', () => {
  // The model repeats an old clock 10 minutes later; neither instant trusts it.
  const later = Date.parse('2026-10-17T13:04:10Z'); // 16:04 EAT
  const out = {
    21: guard('Saa hivi ni saa tisa na dakika hamsini na moja alasiri. Kuna kitu kingine, Alvin?', "And it's a ngapi time?", { now: later, promptClock: later }),
    22: guard('Saahivi ni saa tisa na dakika hamsini na moja alasiri. Kuna kitu kingine, Alvin?', "What's the time?", { now: later, promptClock: later }),
    sw: guard('Ni saa tisa na dakika hamsini na moja alasiri.', 'Ni saa ngapi sasa?', { now: later, promptClock: later, language: 'sw' }),
  };
  assert.match(out[21], /^Saa hii ni saa kumi na dakika nne (?:mchana|jioni), yaani 4:04 PM\. Kuna kitu kingine, Alvin\?$/);
  assert.equal(out[22], "It's 4:04 PM in Kenya now. Kuna kitu kingine, Alvin?");
  assert.match(out.sw, /^Saa hii ni saa kumi na dakika nne (?:mchana|jioni)\.$/);
});
