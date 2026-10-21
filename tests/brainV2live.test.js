'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { brainV2Enabled, brainV2Mode } = require('../src/conversation/v2/flag');
const { createLiveHandlers } = require('../src/conversation/v2/liveHandlers');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');

test('BRAIN_V2 live is off unless both flags are set', () => {
  assert.equal(brainV2Enabled({ env: {} }), false);
  assert.equal(brainV2Mode({ env: {} }), 'shadow');
  assert.equal(brainV2Enabled({ env: { BRAIN_V2: 'on' } }), true);
  assert.equal(brainV2Mode({ env: { BRAIN_V2_MODE: 'live' } }), 'live');
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

test('live turn speaks a services list and does not invent a booking', async () => {
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
  const live = createBrainV2Live({
    env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' },
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
  assert.match(out.line, /Deep clean, one bedroom|Sofa cleaning|We offer/i);
  assert.doesNotMatch(out.line, /1 bedroom/);
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
  const live = createBrainV2Live({
    env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' },
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
  assert.equal(writes.length, 1);
});

// End-call contract (plan C3): { line, end: true, reason } once, goodbye in the same line,
// never with a write proposed and not committed, never when the owner turned end_call off.
const END_PROFILE = { ...PHANTOM_PROFILE, agentTools: { escalate: true, end_call: true } };
function endLive() {
  return createBrainV2Live({
    env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' },
    classify: async () => ({ kind: 'unknown', place: '' }),
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
