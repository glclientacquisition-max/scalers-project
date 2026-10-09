// Call-level scorer checks: visit read, Nairobi date, name lock.
// Run: node --test tests/callChecks.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  callChecks,
  visitReadChecks,
  nairobiDateChecks,
  nameLockChecks,
  nairobiParts,
  turnsFromTranscriptRows,
} = require('../src/speech/callChecks');
const { scoreTurns, diagnoseCall } = require('../src/speech/voiceScore');

function turn(i, caller, spoken, extra = {}) {
  return {
    turnIndex: i,
    caller: { text: caller },
    stages: spoken ? [{ stage: 'tts', text: spoken, before: spoken }] : [],
    ...extra,
  };
}

// 2026-10-08 21:30 UTC is Friday 9 Oct 00:30 in Nairobi.
const AFTER_MIDNIGHT_EAT = '2026-10-08T21:30:00.000Z';
// 2026-10-09 07:10 UTC is Friday 9 Oct 10:10 in Nairobi.
const FRIDAY_MORNING = '2026-10-09T07:10:00.000Z';

describe('Nairobi date', () => {
  it('reads the Nairobi calendar, not UTC', () => {
    const p = nairobiParts(AFTER_MIDNIGHT_EAT);
    assert.deepEqual([p.year, p.month, p.day, p.hour, p.weekday], [2026, 10, 9, 0, 5]);
  });

  it('flags "today is Thursday" after midnight EAT (the UTC date)', () => {
    const rows = nairobiDateChecks([turn(1, 'Leo ni siku gani?', 'Today is Thursday.', { at: AFTER_MIDNIGHT_EAT })]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /friday/);
  });

  it('passes correct relative days in English and Kiswahili', () => {
    const rows = nairobiDateChecks([
      turn(1, 'what day', 'Today is Friday, the 9th of October. Tomorrow is Saturday.', { at: FRIDAY_MORNING }),
      turn(2, 'na kesho', 'Leo ni Ijumaa, kesho ni Jumamosi.', { at: FRIDAY_MORNING }),
    ]);
    assert.deepEqual(rows, []);
  });

  it('passes a weekday that matches the date', () => {
    const rows = nairobiDateChecks([turn(1, 'when', 'We can come on Tuesday, 13 October.', { at: FRIDAY_MORNING })]);
    assert.deepEqual(rows, []);
  });

  it('flags a wrong weekday-date pair', () => {
    const rows = nairobiDateChecks([turn(1, 'when', 'We can come on Monday, 14 October.', { at: FRIDAY_MORNING })]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /wednesday/);
  });

  it('flags kesho with the wrong day name', () => {
    const rows = nairobiDateChecks([turn(1, 'kesho', 'Tutakuja kesho Jumapili.', { at: FRIDAY_MORNING })]);
    assert.equal(rows.length, 1);
  });

  it('checks the time-of-day greeting against Nairobi hours', () => {
    assert.deepEqual(nairobiDateChecks([turn(1, '', 'Good morning, Aris, this is Lynn.', { at: AFTER_MIDNIGHT_EAT })]), []);
    const evening = nairobiDateChecks([turn(1, '', 'Good evening, Aris, this is Lynn.', { at: FRIDAY_MORNING })]);
    assert.equal(evening.length, 1);
  });

  it('falls back to the call time when a turn has none', () => {
    const rows = nairobiDateChecks([turn(1, 'day?', 'Today is Thursday.')], { callAt: AFTER_MIDNIGHT_EAT });
    assert.equal(rows.length, 1);
  });
});

describe('visit read', () => {
  it('passes when the open visit is read out', () => {
    const rows = visitReadChecks([
      turn(1, 'What bookings do I have?', 'You have sofa cleaning, Saturday 10 October, Kilimani. What would you like to do?'),
    ]);
    assert.deepEqual(rows, []);
  });

  it('passes a Kiswahili read and an honest "nothing open"', () => {
    assert.deepEqual(visitReadChecks([turn(1, 'bookings zangu', 'Una usafi wa sofa, kesho saa nne.')]), []);
    assert.deepEqual(visitReadChecks([turn(1, 'Do I have any visits?', 'Nothing is still open. What would you like to do?')]), []);
  });

  it('flags a deflection with no read', () => {
    const rows = visitReadChecks([turn(1, 'When are you coming for my visit?', 'Let me note that for the team to get back to you.')]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /not read/);
  });

  it('flags "nothing open" when open visits are on file', () => {
    const rows = visitReadChecks(
      [turn(1, 'Do I have any visits?', 'Nothing is still open. What would you like to do?')],
      { openVisits: [{ service_name: 'Sofa cleaning', when_text: 'Saturday 10am' }] }
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /1 open visit/);
  });

  it('reads the next agent turn when the ask turn only held', () => {
    const rows = visitReadChecks([
      turn(1, 'What bookings do I have?', ''),
      turn(2, '', 'You have carpet cleaning tomorrow at 10 am.'),
    ]);
    assert.deepEqual(rows, []);
  });

  it('ignores a new booking ask', () => {
    assert.deepEqual(visitReadChecks([turn(1, 'I want to book a visit for Saturday', 'Sure. What service?')]), []);
  });
});

describe('name lock', () => {
  it('locks on a yes to the file name and keeps it', () => {
    const rows = nameLockChecks([
      turn(1, '', 'Good evening, Aris, this is Lynn. Am I speaking with Alvin Yegon?'),
      turn(2, 'Yeah, and how many sets do you have?', 'We have two sets. Anything else, Alvin?'),
    ], { agentName: 'Lynn', businessName: 'Aris' });
    assert.deepEqual(rows, []);
  });

  it('flags a re-ask after the lock (HD_4863 t8 shape)', () => {
    const rows = nameLockChecks([
      turn(1, 'Unaongea na nani?', 'Ni Alvin ninaongea naye?'),
      turn(2, 'Eeh, unaongea na Alvin.', 'Sawa Alvin. Ni huduma gani?'),
      turn(3, 'Naweza ongea na nani?', 'Niambie jina lako ndio niwasiliane na timu.'),
    ]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /asked again/);
  });

  it('flags calling the caller another name, and saving another name', () => {
    const rows = nameLockChecks([
      turn(1, 'Hi, my name is Wanjiru.', 'Thanks, Wanjiru. How can I help?'),
      turn(2, 'I need a sofa cleaned.', 'Sure, Njeri. What day works?'),
      turn(3, 'Saturday.', 'Saturday it is.', {
        stages: [
          { stage: 'model', phase: 'output', outputText: 'Saturday it is. ###TOOL### {"save_caller_info":{"name":"Njeri","reason":"sofa"}} ###ENDTOOL###' },
          { stage: 'tts', text: 'Saturday it is.' },
        ],
      }),
    ]);
    assert.equal(rows.length, 2);
    assert.match(rows[0].note, /called the caller "Njeri"/);
    assert.match(rows[1].note, /saved "Njeri"/);
  });

  it('a "no" to the file name takes the corrected name', () => {
    const rows = nameLockChecks([
      turn(1, '', 'Am I speaking with Alvin?'),
      turn(2, "No, my name is Brian.", 'Sorry about that, Brian. How can I help?'),
      turn(3, 'Price of sofa cleaning?', 'Okay, Brian, it depends on the size.'),
    ]);
    assert.deepEqual(rows, []);
  });

  it('does not lock on "I\'m Looking for"', () => {
    const rows = nameLockChecks([
      turn(1, "I'm Looking for a cleaner", 'Sure. May I have your name?'),
    ]);
    assert.deepEqual(rows, []);
  });
});

describe('scorer wiring', () => {
  it('adds the call-level counts, penalty, notes, and diagnosis', () => {
    const turns = [
      turn(1, 'Today?', 'Today is Thursday.', { at: AFTER_MIDNIGHT_EAT }),
      turn(2, 'When are you coming for my visit?', 'The team will get back to you.', { at: AFTER_MIDNIGHT_EAT }),
    ];
    const card = scoreTurns(turns);
    assert.equal(card.checks.dateWrong, 1);
    assert.equal(card.checks.visitMissed, 1);
    assert.equal(card.checks.nameLock, 0);
    assert.ok(card.score <= 100 - 40 + 0.05, `score ${card.score}`);
    assert.ok(card.turns[0].notes.some((note) => /Nairobi/.test(note)));
    assert.match(diagnoseCall(card), /Nairobi|visits/);
  });

  it('a clean call keeps zero call-level checks', () => {
    const card = scoreTurns([turn(1, 'Hello', 'Hello, how can I help?', { at: FRIDAY_MORNING })]);
    assert.deepEqual([card.checks.visitMissed, card.checks.dateWrong, card.checks.nameLock], [0, 0, 0]);
    assert.deepEqual(callChecks([]).counts, { visitMissed: 0, dateWrong: 0, nameLock: 0, ignoredFile: 0 });
  });
});

describe('transcript rows (prod has no traces)', () => {
  it('groups caller rows and the agent reply into turns, greeting first', () => {
    const turns = turnsFromTranscriptRows(
      [
        { speaker: 'agent', text_content: 'Good morning, Aris, this is Lynn.' },
        { speaker: 'caller', text_content: 'Uh, mainly.' },
        { speaker: 'caller', text_content: 'Nataka kujua bei.' },
        { speaker: 'agent', text_content: 'Je, naongea na Alvin?' },
        { speaker: 'caller', text_content: 'Ndio.' },
        { speaker: 'agent', text_content: 'Sawa Alvin.' },
      ],
      { callId: 'c1', callAt: AFTER_MIDNIGHT_EAT }
    );
    assert.equal(turns.length, 3);
    assert.equal(turns[0].caller.text, '');
    assert.equal(turns[1].caller.text, 'Uh, mainly. Nataka kujua bei.');
    assert.equal(turns[1].stages[0].text, 'Je, naongea na Alvin?');
    assert.equal(turns[2].at, AFTER_MIDNIGHT_EAT);
    const card = scoreTurns(turns, { callAt: AFTER_MIDNIGHT_EAT, agentName: 'Lynn', businessName: 'Aris' });
    assert.deepEqual([card.checks.dateWrong, card.checks.nameLock], [0, 0]);
  });
});

describe('ignored caller file (HD_23445a4f780c)', () => {
  const { ignoredFileChecks } = require('../src/speech/callChecks');
  const hd = require('./fixtures/hd23445TurnsPartial.json');
  const file = hd.callerFile;

  it('HD_23445a4f780c scores clearly lower once the caller file is known', () => {
    const blind = scoreTurns(hd.turns, { callAt: '2026-10-09T07:59:00Z' });
    const known = scoreTurns(hd.turns, { callAt: '2026-10-09T07:59:00Z', callerFile: file });
    assert.equal(known.checks.ignoredFile, 2);
    assert.ok(known.score <= 60, `score ${known.score}`);
    assert.ok(known.score < 96.7 - 30, `score ${known.score}`);
    assert.ok(blind.score - known.score >= 40, `${blind.score} -> ${known.score}`);
    assert.ok(known.callFindings.ignoredFile.some((row) => /no record/.test(row.note)));
    assert.match(diagnoseCall(known), /caller file/i);
  });

  it('confirming the name on file is not ignoring it', () => {
    const turns = [
      turn(1, 'Hello', 'Am I speaking with Alvin?'),
      turn(2, 'Yes', 'Welcome back. How can I help?'),
    ];
    assert.deepEqual(ignoredFileChecks(turns, { callerFile: file }), []);
  });

  it('reading the open visit counts as using the file', () => {
    const turns = [turn(1, 'Hello', 'Hello. The carpet cleaning is set for today at 9 AM. Anything else?')];
    assert.deepEqual(ignoredFileChecks(turns, { callerFile: { openVisits: file.openVisits } }), []);
  });

  it('a catalogue list naming the same job is not a file mention', () => {
    const turns = [turn(1, 'What do you do?', 'We do house, carpet, sofa and mattress cleaning.')];
    const rows = ignoredFileChecks(turns, { callerFile: { openVisits: file.openVisits } });
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /never confirmed/);
  });

  it('"no record" is penalised even after the name was used', () => {
    const turns = [turn(1, 'Hi', "Hi Alvin. Sorry, I don't have any record of that.")];
    const rows = ignoredFileChecks(turns, { callerFile: file });
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /no record/);
  });

  it('a new caller with no file is never flagged', () => {
    const turns = [turn(1, 'Hi', 'Sina kumbukumbu ya hilo. Ungependa huduma gani?')];
    assert.deepEqual(ignoredFileChecks(turns, {}), []);
    assert.deepEqual(ignoredFileChecks(turns, { callerFile: { name: null, openVisits: [], openRequests: [] } }), []);
  });
});
