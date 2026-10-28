'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLiveHandlers } = require('../src/conversation/v2/liveHandlers');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const V2 = require('../src/conversation/v2');
const { callerFile, endDecision: liveEndDecision } = require('../src/conversation/v2/liveTurn');

// B2: createBrainV2Live always runs the engines, so the rules-machine behaviours these tests pinned through
// live.run (phantom cancel, end-call, clock) are now pinned on the machine itself (V2.runTurn + the same live
// handlers + the same endDecision live.run applies). Engine-level expectations use createBrainV2Live directly.
function machineLive({ now, callerFile: cf, applyTools }) {
  let st = null; let ended = false;
  const handlers = createLiveHandlers({ applyTools });
  return {
    getState: () => st,
    async run({ text, profile, langLock }) {
      if (!st) { const f = callerFile({ callerFile: cf }); st = V2.createState({ profile, callerPhone: f.callerPhone, contactName: f.contactName, openRows: f.openRows }); }
      const r = await V2.runTurn(st, { text, profile, now: now(), handlers, langLock });
      const e = liveEndDecision({ done: r, machine: st, profile, line: r.line, alreadyEnded: ended });
      if (e.end) ended = true;
      return { ...r, end: e.end === true, endHeld: e.held, reason: e.reason };
    },
  };
}

// Pinned clock: a Thursday mid-morning EAT, so "tomorrow" never hits the small-hours
// "later today or tomorrow?" question whatever time CI runs (Platform, 22 Oct).
const DAY_EAT = '2026-10-22T10:00:00+03:00';

test('B2: v2 live has no on/off switch: the flag module is gone and a live turn runs with no env set', async () => {
  assert.throws(() => require('../src/conversation/v2/flag'), /Cannot find module/);
  const live = createBrainV2Live({ env: {}, applyTools: async () => ({ results: [] }), prewarm: false, log: () => {} });
  const r = await live.run({ text: 'Hello', profile: { id: 't1', name: 'Test Co', services: [] }, langLock: 'en' });
  assert.ok(String(r.line || '').trim(), 'a line is always spoken');
});

test('live handlers write through applyTools, not dry-run', async () => {
  const seen = [];
  const handlers = createLiveHandlers({
    applyTools: async (parsed) => {
      seen.push(parsed);
      return { results: [{ action: 'create_appointment', status: 'succeeded', id: 'apt_1' }] };
    },
  });
  const out = await handlers.createAppointment({ serviceName: 'Sofa cleaning', whenText: 'Friday 10am', name: 'Aisha' });
  assert.equal(out.id, 'apt_1');
  assert.equal(seen[0].appointment.serviceName, 'Sofa cleaning');
});

test('live turn (engines) speaks a services list and does not invent a booking', async () => {
  const profile = {
    id: 'tenant-1',
    businessName: 'Jirani Cleaning Services',
    agentName: 'Wanjiru',
    servicesCatalog: [
      { name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500' },
      { name: 'Sofa cleaning', price_range: 'From KSh 2,500' },
    ],
  };
  const writes = [];
  // stand-in models: typed understanding + a grounded reply (no network, no keys)
  const streamFor = () => async ({ request }) => (request.generationConfig?.responseSchema?.properties?.intent
    ? { text: JSON.stringify({ intent: 'ask', answers: ['services'], slots: {}, language: 'en' }) }
    : { text: JSON.stringify({ reply: 'We do sofa cleaning and deep cleaning.' }) });
  const live = createBrainV2Live({
    env: {},
    now: () => new Date(DAY_EAT),
    prewarm: false,
    log: () => {},
    modelLeadStreamFor: streamFor,
    applyTools: async (parsed) => {
      writes.push(parsed);
      return { results: [] };
    },
  });
  const out = await live.run({
    text: 'which services do you offer?',
    profile,
    langLock: 'en',
  });
  assert.match(out.line, /sofa cleaning|deep clean/i);
  assert.match(String(out.path || ''), /^brain_engines/);
  assert.doesNotMatch(out.line, /booked|nimeweka/i);
  assert.equal(writes.length, 0);
});

// Phantom cancel (staging, #833): an open callback request from an earlier call ("kesho", no
// window) reached the v2 file as a visit, so "I want to cancel" read back
// "Cancel your deep clean, one bedroom on . Shall I go ahead?" and "Yes" wrote an
// appointment update against a service request id.
const PHANTOM_PROFILE = {
  id: 'tenant-1',
  businessName: 'Jirani Cleaning Services',
  agentName: 'Wanjiru',
  servicesCatalog: [{ name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500' }, { name: 'Sofa cleaning', price_range: 'KSh 2,500' }],
};
function phantomLive(openRows) {
  const writes = [];
  const live = machineLive({
    now: () => new Date(DAY_EAT),
    callerFile: { callerPhone: '+254700000001', openRows },
    applyTools: async (parsed) => { writes.push(parsed); return { results: [{ action: 'update_appointment', status: 'succeeded', id: 'x' }] }; },
  });
  return { live, writes };
}

test('phantom cancel: an open callback request is not a cancellable visit (EN + SW)', async () => {
  const request = { id: 'sr_1', kind: 'request', type: 'callback', job: 'Deep clean, 1 bedroom', when: 'kesho', windowStart: null, status: 'new' };
  for (const [lang, ask, yes] of [['en', 'I want to cancel my booking.', 'Yes.'], ['sw', 'Nataka kufuta booking yangu.', 'Ndio.']]) {
    const { live, writes } = phantomLive([request]);
    const a = await live.run({ text: ask, profile: PHANTOM_PROFILE, langLock: lang });
    assert.doesNotMatch(a.line, /\bon \.|\bya \.|Shall I go ahead\?|Niendelee\?/, `${lang}: ${a.line}`);
    await live.run({ text: yes, profile: PHANTOM_PROFILE, langLock: lang });
    assert.equal(writes.length, 0, `${lang}: no write against a request row`);
  }
});

test('phantom cancel: a visit with no window speaks the caller\'s date words, never an empty date', async () => {
  const visit = { id: 'apt_1', kind: 'visit', type: 'visit', job: 'Sofa cleaning', when: 'kesho', windowStart: null, status: 'requested' };
  const { live } = phantomLive([visit]);
  const a = await live.run({ text: 'I want to cancel my booking.', profile: PHANTOM_PROFILE, langLock: 'en' });
  assert.match(a.line, /sofa cleaning on kesho\. Shall I go ahead\?/i);
  assert.doesNotMatch(a.line, /\bon \./);
  const bare = phantomLive([{ id: 'apt_2', service_name: 'Sofa cleaning', status: 'requested' }]);
  const b = await bare.live.run({ text: 'I want to cancel my booking.', profile: PHANTOM_PROFILE, langLock: 'en' });
  assert.match(b.line, /Cancel your sofa cleaning\. Shall I go ahead\?/);
});

test('phantom cancel: a dated visit still reads back its date', async () => {
  const { live, writes } = phantomLive([{ id: 'apt_3', service_name: 'Sofa cleaning', window_start: '2026-10-23T07:00:00Z', status: 'requested' }]);
  const a = await live.run({ text: 'I want to cancel my booking.', profile: PHANTOM_PROFILE, langLock: 'en' });
  assert.match(a.line, /Cancel your sofa cleaning on Friday 23 October at 10:00\. Shall I go ahead\?/);
  await live.run({ text: 'Yes.', profile: PHANTOM_PROFILE, langLock: 'en' });
  // the fake answers id 'x' for apt_3; with BRAIN_V2_COMMIT_SAFETY that mismatch is a failed write and opens one outbox task
  assert.equal(writes.filter((w) => w.appointmentUpdate).length, 1);
});

// End-call contract (plan C3): { line, end: true, reason } once, goodbye in the same line,
// never with a write proposed and not committed, never when the owner turned end_call off.
const END_PROFILE = { ...PHANTOM_PROFILE, agentTools: { escalate: true, end_call: true } };
function endLive(now = DAY_EAT) {
  return machineLive({
    now: () => new Date(now),
    applyTools: async () => ({ results: [{ action: 'create_appointment', status: 'succeeded', id: 'apt_1' }] }),
  });
}

test('end-call: "No thanks, that\'s all. Bye." ends once, with the goodbye in the same line', async () => {
  const live = endLive();
  const out = await live.run({ text: "No thanks, that's all. Bye.", profile: END_PROFILE, langLock: 'en' });
  assert.equal(out.end, true);
  assert.equal(out.reason, 'caller_done');
  assert.match(out.line, /goodbye/i);
  const again = await live.run({ text: 'Bye.', profile: END_PROFILE, langLock: 'en' });
  assert.equal(again.end, false, 'emitted once per call');
});

test('end-call: owner end_call off means no end signal (the goodbye is still spoken)', async () => {
  const live = endLive();
  const out = await live.run({ text: "No thanks, that's all. Bye.", profile: { ...END_PROFILE, agentTools: { escalate: true, end_call: false } }, langLock: 'en' });
  assert.match(out.line, /goodbye/i);
  assert.equal(out.end, false);
  assert.equal(out.endHeld, 'end_call_off');
});

test('end-call: never while a write is proposed and not committed', () => {
  const { endDecision } = require('../src/conversation/v2/liveTurn');
  const done = { end: true, endReason: 'caller_done' };
  assert.deepEqual(endDecision({ done, machine: { phase: 'readback', pending: { tool: 'create_booking' } }, profile: END_PROFILE, line: 'Goodbye.' }), { end: false, held: 'write_pending' });
  assert.deepEqual(endDecision({ done: { ...done, awaitingConfirm: true }, machine: { phase: 'collect' }, profile: END_PROFILE, line: 'Goodbye.' }), { end: false, held: 'write_pending' });
  assert.deepEqual(endDecision({ done: { ...done, toolResults: [{ status: 'failed' }] }, machine: { phase: 'collect' }, profile: END_PROFILE, line: 'Goodbye.' }), { end: false, held: 'write_failed' });
  assert.deepEqual(endDecision({ done, machine: { phase: 'collect' }, profile: END_PROFILE, line: '' }), { end: false, held: 'empty_line' });
  assert.deepEqual(endDecision({ done, machine: { phase: 'collect' }, profile: END_PROFILE, line: 'Goodbye.' }), { end: true, reason: 'caller_done' });
});

test('end-call: an ack run ("sawa" x3) says goodbye but does not hang up on a listener', async () => {
  const live = endLive();
  let out;
  for (const t of ['Sawa.', 'Sawa.', 'Sawa.']) out = await live.run({ text: t, profile: END_PROFILE, langLock: 'sw' });
  assert.match(out.line, /Kwaheri/);
  assert.equal(out.end, false);
  assert.equal(out.endHeld, 'ack_run');
});

test('end-call: declining the read-back with a goodbye ends (the proposal is dropped, nothing pending)', async () => {
  const live = endLive();
  const P = { ...END_PROFILE, vertical: 'home_services', serviceAreas: { areas: [{ id: 'place:kilimani' }] } };
  const rb = await live.run({ text: 'I want sofa cleaning tomorrow at 10am in Kilimani, my name is Alvin.', profile: P, langLock: 'en' });
  assert.match(rb.line, /Shall I book it\?/);
  assert.equal(rb.end, false);
  const out = await live.run({ text: "No thanks, that's all. Bye.", profile: P, langLock: 'en' });
  assert.equal(live.getState().pending, null);
  assert.match(out.line, /Goodbye/);
  assert.equal(out.end, true);
});

test('clock is injected: "tomorrow" at 02:30 EAT asks later-today-or-tomorrow; at 10:00 EAT reads back', async () => {
  const P = { ...END_PROFILE, vertical: 'home_services', serviceAreas: { areas: [{ id: 'place:kilimani' }] } };
  const text = 'I want sofa cleaning tomorrow at 10am in Kilimani, my name is Alvin.';
  const night = await endLive('2026-10-22T02:30:00+03:00').run({ text, profile: P, langLock: 'en' });
  assert.match(night.line, /later today, Thursday the 22nd, or Friday the 23rd\?/);
  const day = await endLive(DAY_EAT).run({ text, profile: P, langLock: 'en' });
  assert.match(day.line, /Shall I book it\?/);
});
