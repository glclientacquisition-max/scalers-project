const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCallerMemoryCard, pageCallerVisitReview, formatReturningCallerForPrompt, bindCallerMemoryCard } = require('../src/conversation/callerMemory');
const {
  looksLikeOpenVisitLookup,
  openLineHoldDecision,
  planVisitReadTurn,
} = require('../src/conversation/openLineSpeech');
const { messageOnlyNoVisitLine } = require('../src/conversation/messageOnly');

const PHONE = '+254790381872';
const WHEN = 'Monday 5 October 2026, anytime from the morning';

test('2:17 AM shape: code lists the open visit and the model does not run', () => {
  for (const said of [
    'What bookings do I have?',
    'Just list them.',
    'I just wanted them listed',
    'Update me about what I have',
    'Nini niko nayo?',
  ]) {
    assert.equal(looksLikeOpenVisitLookup(said), true, said);
  }
  assert.equal(looksLikeOpenVisitLookup('change my booking'), false);
  assert.equal(looksLikeOpenVisitLookup('cancel my visit'), false);

  const card = buildCallerMemoryCard({
    contact: {
      phone: PHONE,
      name: 'Alvin',
      metadata: { alternate_names: [{ name: 'Brian' }] },
    },
    nextAppointment: {
      id: 'couch-1',
      service_name: 'Couch cleaning',
      status: 'requested',
      when_text: WHEN,
      address_landmark: 'Westlands',
      created_at: '2026-10-04T23:17:00.000Z',
    },
  });
  assert.equal(card.phone, PHONE);
  assert.match(card.openVisits[0], new RegExp(WHEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(card.openVisits[0], /\.\.\./);

  const named = openLineHoldDecision({
    nameConfirmed: false,
    callerText: 'What bookings do I have? Just list them.',
  });
  assert.equal(named.holdVisitLookup, false);

  const just = planVisitReadTurn({
    nameConfirmed: true,
    nameJustConfirmed: true,
    callerText: 'Yes. What bookings do I have?',
    openVisits: card.openVisits,
  });
  assert.equal(just.runModel, true);
  assert.equal(just.line, '');

  const read = planVisitReadTurn({
    nameConfirmed: true,
    nameJustConfirmed: false,
    callerText: 'What bookings do I have? Just list them.',
    openVisits: card.openVisits,
    language: 'en',
  });
  assert.equal(read.runModel, false);
  assert.equal(
    read.line,
    'You have Couch cleaning, Monday 5 October 2026, anytime from the morning, Westlands. What would you like to do?'
  );
  assert.doesNotMatch(read.line, /which visit would you like to update/i);
  assert.doesNotMatch(read.line, /8 AM|08:00/);
  assert.doesNotMatch(read.line, /\.\.\./);

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = server.indexOf('async function runCallerTurn');
  const end = server.indexOf('function flushUtterance', start);
  const turnSource = server.slice(start, end);
  const visitAt = turnSource.indexOf('planVisitReadTurn(');
  const modelAt = turnSource.indexOf('runGeminiTurn');
  assert.ok(visitAt >= 0 && modelAt > visitAt);
  const between = turnSource.slice(visitAt, modelAt);
  assert.match(between, /visitRead\.runModel === false/);
  assert.match(between, /speakText\(visitRead\.line\)/);
  assert.match(between, /return;/);
  assert.doesNotMatch(server, /Which visit would you like to update/);

  const promptStart = server.indexOf("if (data.type === 'prompt')");
  const promptEnd = server.indexOf("ws.on('error'", promptStart);
  const promptSource = server.slice(promptStart, promptEnd);
  const promptVisit = promptSource.indexOf('planVisitReadTurn(');
  const promptModel = promptSource.indexOf('runGeminiTurn');
  assert.ok(promptVisit >= 0 && promptModel > promptVisit);
});

test('a review goes past the clip of 2, including a later page, with no maximum of 20', () => {
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    rows.push({
      id: `job-${i}`,
      service_name: `Job ${i}`,
      status: i < 3 ? 'requested' : 'done',
      when_text: `6 October 2026, anytime from the morning, note ${i}`,
      address_landmark: 'Westlands',
      created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    });
  }
  const card = buildCallerMemoryCard({
    contact: { phone: PHONE, name: 'Alvin', metadata: {} },
    recentAppointments: rows,
  });
  assert.equal(card.recentBookings.length, 2);
  const bound = bindCallerMemoryCard(card, 'Alvin');
  const prompt = formatReturningCallerForPrompt(bound);
  assert.doesNotMatch(prompt, /Job 24/);
  assert.doesNotMatch(prompt, /Job 20/);

  const seen = [];
  let page = 0;
  let last = null;
  for (;;) {
    const got = pageCallerVisitReview(rows, { page, pageSize: 8, scope: 'all' });
    assert.ok(got.lines.length > 0, `page ${page}`);
    if (page === 0) assert.ok(got.lines.length > 2);
    seen.push(...got.lines);
    last = got;
    if (!got.hasMore) break;
    page += 1;
    assert.ok(page < 10);
  }
  assert.ok(page >= 1);
  assert.equal(last.total, 25);
  assert.equal(seen.length, 25);
  assert.match(seen[0], /^Job 2 \|/);
  assert.match(seen[1], /^Job 1 \|/);
  assert.match(seen[2], /^Job 0 \|/);
  assert.match(seen[3], /^Job 24 \|/);
  assert.match(seen[seen.length - 1], /^Job 3 \|/);
  for (const line of seen) {
    assert.match(line, /6 October 2026, anytime from the morning, note /);
    assert.doesNotMatch(line, /\.\.\./);
  }

  const first = planVisitReadTurn({
    nameConfirmed: true,
    callerText: 'What bookings do I have?',
    appointments: rows,
  });
  assert.equal(first.runModel, false);
  assert.match(first.line, /You have Job 2,/);
  assert.doesNotMatch(first.line, /Job 24/);
  assert.doesNotMatch(first.line, /which visit would you like to update/i);

  const older = planVisitReadTurn({
    nameConfirmed: true,
    callerText: 'Show me the older ones',
    appointments: rows,
    cursor: first.cursor,
  });
  assert.equal(older.runModel, false);
  assert.match(older.line, /You have Job 24,/);
  assert.equal(older.cursor.phase, 'done');

  let cursor = { phase: 'all', page: 0 };
  const walked = [];
  for (let step = 0; step < 10; step += 1) {
    const turn = planVisitReadTurn({
      nameConfirmed: true,
      callerText: step === 0 ? 'my history' : 'the rest',
      appointments: rows,
      cursor,
    });
    assert.equal(turn.runModel, false);
    walked.push(turn.line);
    cursor = turn.cursor;
    if (!turn.hasMore) break;
  }
  const joined = walked.join(' ');
  assert.match(joined, /Job 0/);
  assert.match(joined, /Job 24/);
  assert.match(joined, /Job 3/);

  const quiet = planVisitReadTurn({
    nameConfirmed: true,
    messageOnly: true,
    callerText: 'What bookings do I have? Just list them.',
    appointments: rows,
    openVisits: card.openVisits,
  });
  assert.equal(quiet.runModel, false);
  assert.equal(quiet.line, messageOnlyNoVisitLine('en'));
  assert.doesNotMatch(quiet.line, /Job 2|Couch|Westlands/);

  const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const fnAt = db.indexOf('async function listCallerAppointmentsForReview');
  const nextFn = db.indexOf('async function getCallerMemory', fnAt);
  const body = db.slice(fnAt, nextFn);
  assert.ok(fnAt > 0 && nextFn > fnAt);
  assert.doesNotMatch(body, /\.limit\(\s*20\s*\)/);
  assert.doesNotMatch(body, /\.limit\(\s*6\s*\)/);
  assert.doesNotMatch(body, /\.limit\(\s*2\s*\)/);
  assert.match(body, /for \(;;\)/);
  assert.doesNotMatch(db.slice(nextFn, nextFn + 800), /listCallerAppointmentsForReview/);
});
