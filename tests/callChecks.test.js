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
    assert.deepEqual(callChecks([]).counts, { visitMissed: 0, dateWrong: 0, nameLock: 0, ignoredFile: 0, holdMissed: 0, falseMove: 0, swTimeWrong: 0 });
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

describe('HD_d199dbbf6b79: hold not read, false move, wrong Kiswahili time', () => {
  const { holdMissedChecks, falseMoveChecks, swTimeChecks, swClockReadings } = require('../src/speech/callChecks');
  const hd = require('./fixtures/hdD199Turns.json');
  const ctx = { callAt: hd.callAt, callerFile: hd.callerFile, callVisits: hd.callVisits };

  it('drops well below 100 once the file and call visits are known', () => {
    // Without the file the scorer still hears "saa 9 asubuhi" (no Swahili reading).
    const blind = scoreTurns(hd.turns, { callAt: hd.callAt });
    const known = scoreTurns(hd.turns, ctx);
    assert.equal(blind.checks.swTimeWrong, 2);
    assert.equal(known.checks.holdMissed, 2);
    assert.equal(known.checks.falseMove, 1);
    assert.equal(known.checks.swTimeWrong, 2);
    assert.ok(known.score <= 40, `score ${known.score}`);
    assert.ok(blind.score - known.score >= 25, `${blind.score} -> ${known.score}`);
    // Before these checks the call scored 92.5 (only slow first audio).
    assert.ok(92.5 - known.score >= 50, `${known.score}`);
    assert.deepEqual(known.callFindings.holdMissed.map((r) => r.turnIndex), [4, 5]);
    assert.deepEqual(known.callFindings.falseMove.map((r) => r.turnIndex), [16]);
    assert.deepEqual(known.callFindings.swTimeWrong.map((r) => r.turnIndex), [12, 16]);
  });

  it('holdMissed: reading the hold passes; a denial or a coverage line does not', () => {
    const file = hd.callerFile;
    assert.deepEqual(
      holdMissedChecks([turn(1, 'What about the mansion one?', 'Your mansion cleaning quote from last night is still open. Want me to book it?')], { callerFile: file }),
      []
    );
    assert.equal(holdMissedChecks([turn(1, 'What about the mansion one?', "I'm not sure we cover that area.")], { callerFile: file }).length, 1);
    assert.equal(holdMissedChecks([turn(1, 'the mansion one', 'I do not have a visit saved for a mansion on your file.')], { callerFile: file }).length, 1);
    // The caller never asked about it: nothing to miss.
    assert.deepEqual(holdMissedChecks([turn(1, 'How much is window cleaning?', 'KSh 200 per window.')], { callerFile: file }), []);
    // Generic words ("quote") do not count as asking about this hold.
    assert.deepEqual(holdMissedChecks([turn(1, 'Can I get a quote?', 'Sure, for which service?')], { callerFile: file }), []);
  });

  it('falseMove: only when a new visit was made and the old one is still open', () => {
    const line = [turn(1, 'Confirm?', 'Nimehamisha ziara Jumamosi, saa tatu asubuhi.')];
    assert.equal(falseMoveChecks(line, ctx).length, 1);
    assert.equal(falseMoveChecks([turn(1, 'x', "Okay, I've moved that visit to Saturday at 9 AM.")], ctx).length, 1);
    // A real update (no new visit on the call) is fine.
    assert.deepEqual(falseMoveChecks(line, { callerFile: hd.callerFile, callVisits: [] }), []);
    // A new visit with no earlier open one is fine.
    assert.deepEqual(falseMoveChecks(line, { callerFile: { name: 'Alvin', openVisits: [], openRequests: [] }, callVisits: hd.callVisits }), []);
    // No move claim, no finding.
    assert.deepEqual(falseMoveChecks([turn(1, 'x', 'Nimehifadhi ombi la ziara Jumamosi, saa tatu asubuhi.')], ctx), []);
  });

  it('swTimeWrong: Swahili clock is 24h minus 6', () => {
    assert.deepEqual(swClockReadings('tatu', {}, 'asubuhi'), [9 * 60]);
    assert.deepEqual(swClockReadings('9', {}, 'asubuhi'), []);
    assert.deepEqual(swClockReadings('tisa', {}, 'mchana'), [15 * 60]);
    assert.deepEqual(swClockReadings('nne', { less: 'robo' }, 'asubuhi'), [9 * 60 + 45]);
    const good = [turn(1, 'x', 'Nimehifadhi ombi la ziara Jumamosi, saa tatu asubuhi.')];
    assert.deepEqual(swTimeChecks(good, ctx), []);
    assert.equal(swTimeChecks([turn(1, 'x', 'Nimehifadhi ombi la ziara Jumamosi, saa 9 asubuhi.')], ctx).length, 1);
    assert.equal(swTimeChecks([turn(1, 'x', 'Ziara yako ni Jumamosi saa nne asubuhi.')], ctx).length, 1);
    // Business hours are not a visit time.
    assert.deepEqual(swTimeChecks([turn(1, 'x', 'Tunafungua saa mbili asubuhi hadi saa kumi na mbili jioni.')], ctx), []);
  });
});

describe('brain.lines[] on the trace (docs/specs/fact-lines.md)', () => {
  const { brainMoveChecks, brainLinesOf, callChecks } = require('../src/speech/callChecks');
  const hd = require('./fixtures/hdD199Turns.json');
  const OLD = '47362e7b-0000-4000-8000-000000000001'; // filed: Friday 9 AM, still requested
  const NEW = 'b140110d-0000-4000-8000-000000000002'; // created on HD_d199: Saturday 9 AM
  const SAT_9 = { iso: '2026-10-10T06:00:05.611Z', precision: 'time' };
  const callerFile = { ...hd.callerFile, openVisits: hd.callerFile.openVisits.map((v) => ({ ...v, id: OLD })) };
  const callVisits = hd.callVisits.map((v) => ({ ...v, id: NEW }));
  const withLines = (lines) => ({ turnIndex: 16, caller: { text: 'Ihamishe' }, stages: [], brain: { lines } });
  const moveOk = (id, extra = {}) => ({
    template: 'move_ok',
    lang: 'sw',
    slots: { to_when: SAT_9, job: 'Carpet Cleaning' },
    gate: { appointment_id: id, to_when: SAT_9, filed_visit: id === OLD },
    text: 'Sawa, nimehamisha ziara ya Carpet Cleaning hadi kesho Jumamosi, saa tatu asubuhi.',
    ...extra,
  });

  it('reads turn.brain.lines and a brain stage', () => {
    assert.equal(brainLinesOf(withLines([moveOk(NEW)])).length, 1);
    assert.equal(brainLinesOf({ stages: [{ stage: 'brain', lines: [moveOk(NEW)] }] }).length, 1);
    assert.deepEqual(brainLinesOf({ stages: [] }), []);
  });

  it('HD_d199 shape: move_ok on the new row while the filed visit is still open is a fail', () => {
    const found = brainMoveChecks([withLines([moveOk(NEW)])], { callerFile, callVisits });
    assert.equal(found.length, 1);
    assert.match(found[0].note, /earlier visit .* still open/);
  });

  it('move_ok on the filed row with a second live visit made on the call is a fail', () => {
    const gateVisits = [{ id: OLD, service_name: 'Carpet Cleaning', window_start: SAT_9.iso, status: 'requested' }];
    const found = brainMoveChecks([withLines([moveOk(OLD)])], { callerFile, callVisits, gateVisits });
    assert.equal(found.length, 1);
    assert.match(found[0].note, /second live visit/);
  });

  it('the moved row not holding the new time is a fail', () => {
    const gateVisits = [{ id: OLD, service_name: 'Carpet Cleaning', window_start: '2026-10-09T06:00:29.205Z', status: 'requested' }];
    const found = brainMoveChecks([withLines([moveOk(OLD)])], { callerFile, callVisits: [], gateVisits });
    assert.match(found[0].note, /does not hold the new time/);
  });

  it('a clean move passes: filed row holds the new time, no second visit', () => {
    const gateVisits = [{ id: OLD, service_name: 'Carpet Cleaning', window_start: SAT_9.iso, status: 'requested' }];
    assert.deepEqual(brainMoveChecks([withLines([moveOk(OLD)])], { callerFile, callVisits: [], gateVisits }), []);
    // A different job created on the same call is not a duplicate.
    const other = [{ id: NEW, service_name: 'Sofa Cleaning', status: 'requested' }];
    assert.deepEqual(brainMoveChecks([withLines([moveOk(OLD)])], { callerFile, callVisits: other, gateVisits }), []);
  });

  it('move_ok without a gate id, and visit_updated that says moved, are fails', () => {
    assert.match(brainMoveChecks([withLines([moveOk(null)])], {})[0].note, /no moved visit id/);
    const updated = { template: 'visit_updated', lang: 'en', slots: {}, gate: { appointment_id: OLD }, text: "Okay, I've moved that visit." };
    assert.equal(brainMoveChecks([withLines([updated])], {}).length, 1);
    assert.deepEqual(brainMoveChecks([withLines([{ ...updated, text: "Okay, I've updated that visit." }])], {}), []);
  });

  it('the spoken claim and the trace line on one turn count once in falseMove', () => {
    const t = { ...withLines([moveOk(NEW)]), stages: [{ stage: 'tts', text: 'Nimehamisha ziara Jumamosi, saa tatu asubuhi.' }] };
    const out = callChecks([t], { callerFile, callVisits });
    assert.equal(out.counts.falseMove, 1);
  });
});

// HD_ceba9d9b3f37 (staging 2026-10-09 12:59 EAT): "My booking, please." got
// the file-name ask; the read-out came on the confirm turn ("Yeah."). The
// caller's last "That's all." ran after the hangup and got no reply.
describe('HD_ceba9d9b3f37: read on the confirm turn; no silence after the hangup', () => {
  const READ =
    'You have a Carpet Cleaning visit request for today, Friday, at 9 AM, in Kitengela. You have a Carpet Cleaning (per room) visit request for tomorrow, Saturday, at 9 AM, in Kitengela, Grace Apartments.';
  const canned = (path, text) => ({ stage: 'canned', path, text });

  it('the read on the confirm turn counts for the visit ask', () => {
    const turns = [
      { ...turn(1, 'My booking, please.', 'Am I speaking with Alvin?'), stages: [canned('file_name_ask', 'Am I speaking with Alvin?'), { stage: 'tts', text: 'Am I speaking with Alvin?' }] },
      { ...turn(2, 'Yeah.', READ), stages: [canned('visit_read', READ), { stage: 'tts', text: READ }] },
    ];
    assert.deepEqual(visitReadChecks(turns, {}), []);
    // Brain fact lines alone (no canned row) also count.
    const viaLines = [turns[0], { ...turn(2, 'Yes.', 'Sawa.'), brain: { lines: [{ template: 'visit_open', slots: {} }] } }];
    assert.deepEqual(visitReadChecks(viaLines, {}), []);
  });

  it('still a miss when the confirm turn reads nothing, or the caller says no', () => {
    const ask = turn(1, 'My booking, please.', 'Am I speaking with Alvin?');
    assert.equal(visitReadChecks([ask, turn(2, 'Yeah.', 'How can I help you today?')], {}).length, 1);
    assert.equal(visitReadChecks([ask, turn(2, 'No, this is Grace.', READ)], {}).length, 1);
    assert.equal(visitReadChecks([turn(1, 'My booking, please.', 'Sure, one moment.'), turn(2, 'Yeah.', READ)], {}).length, 1);
  });

  it('the last "That\'s all." after the hangup is not silence; a mid-call one still is', () => {
    const last = turn(6, "That's all.", '', { stages: [{ stage: 'turn_end', decision: 'flush' }, { stage: 'outcome', value: 'early_return' }] });
    const before = turn(5, 'Okay, thank you.', 'Is there anything else I can help you with?');
    const scored = scoreTurns([before, last], {});
    assert.equal(scored.checks.silence, 0);
    assert.ok(scored.turns.find((t) => t.turnIndex === 6).notes.includes('caller hung up; no reply owed'));
    // Voice now traces the call end: any last words then are not silence.
    const traced = turn(6, 'Hello?', '', { stages: [{ stage: 'turn_end', decision: 'skip', reason: 'call_over' }] });
    assert.equal(scoreTurns([before, traced], {}).checks.silence, 0);
    // Not the last turn, or not a close: still silence.
    assert.equal(scoreTurns([last, before], {}).checks.silence, 1);
    assert.equal(scoreTurns([before, turn(6, 'What about Saturday?', '')], {}).checks.silence, 1);
  });
});
