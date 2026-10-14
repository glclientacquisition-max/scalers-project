'use strict';
// CALLER_INFO_P1 + BRAIN_TRUST_P1: caller-info handling design. The research
// eval cases (briefs/caller-info-brain-audit.md) assert final in-memory DB
// state through executeBrainTools / planTrustTurn / shapeSpeech.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRAIN_TRUST_P1 = 'on';
process.env.CALLER_INFO_P1 = 'on';

const ci = require('../src/conversation/callerInfoTrust');
const trust = require('../src/conversation/trustP1');
const { executeBrainTools, formatToolConfirmation } = require('../src/conversation/toolExecution');
const { resolveAppointmentWhen } = require('../src/conversation/appointmentHours');
const { createBrainState } = require('../src/conversation/brainState');
const { deriveCallSummary } = require('../src/conversation/callSummary');

const PHONE = '+254712345678';
const OTHER = '+254799000111';
const NOW = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT

function fakeDb(appts = [], requests = []) {
  const db = { appointments: appts.map((a) => ({ ...a })), requests: requests.map((r) => ({ ...r })) };
  db.handlers = {
    createAppointment: async (v) => { const row = { id: `a${db.appointments.length + 1}`, status: 'requested', service_name: v.serviceName, caller_phone: PHONE, window_start: v.windowStart, idempotency_key: v.idempotencyKey }; db.appointments.push(row); return row; },
    updateAppointment: async (v) => { const row = db.appointments.find((a) => a.id === v.appointmentId); if (!row) return null; if (v.status) row.status = v.status; if (v.windowStart) row.window_start = v.windowStart; if (v.landmark) row.address_landmark = v.landmark; return row; },
    createServiceRequest: async (v) => { const row = { id: `r${db.requests.length + 1}`, request_type: v.type, item: v.item, notes: v.notes, status: 'open' }; db.requests.push(row); return row; },
    escalate: async () => ({ ok: false, reason: 'no channel', fallbackCallback: true }),
  };
  return db;
}
const CAPS = { createAppointment: true, updateAppointment: true, createServiceRequest: true, escalate: true };
const TWO_VISITS = [
  { id: 'v-fri', service_name: 'Carpet cleaning', status: 'requested', caller_phone: PHONE, window_start: '2026-10-16T07:00:00Z' },
  { id: 'v-mon', service_name: 'Sofa cleaning', status: 'requested', caller_phone: PHONE, window_start: '2026-10-19T07:00:00Z' },
  { id: 'v-other', service_name: 'Carpet cleaning', status: 'requested', caller_phone: OTHER, window_start: '2026-10-16T07:00:00Z' },
];
const run = (db, parsed, extra = {}) => executeBrainTools({ parsed, capabilities: CAPS, handlers: db.handlers, openAppointments: db.appointments, callerPhone: PHONE, now: NOW, nameConfirmed: true, heldCallerName: 'Wanjiru', ...extra });

// ---------------------------------------------------------------- P0-1
test('eval 1: two open visits + "cancel my booking" → which one; then only Friday cancelled after yes', async () => {
  const db = fakeDb(TWO_VISITS);
  const state = createBrainState({});
  let out = await run(db, { appointmentUpdate: { status: 'cancelled' } }, { trustState: state, callerText: 'cancel my booking' });
  assert.match(formatToolConfirmation(out.results, 'en'), /Carpet cleaning on Friday or Sofa cleaning on Monday/);
  out = await run(db, { appointmentUpdate: { status: 'cancelled' } }, { trustState: state, callerText: 'the Friday one' });
  assert.match(formatToolConfirmation(out.results, 'en'), /Cancel your Carpet cleaning on Friday\? Say yes/);
  assert.equal(db.appointments.find((a) => a.id === 'v-fri').status, 'requested', 'nothing cancelled before the yes');
  const plan = trust.planTrustTurn({ text: 'Yes', state, language: 'en' });
  assert.equal(plan.kind, 'apply');
  out = await run(db, plan.parsed, { trustState: state, callerText: 'Yes' });
  assert.equal(db.appointments.find((a) => a.id === 'v-fri').status, 'cancelled');
  assert.equal(db.appointments.find((a) => a.id === 'v-mon').status, 'requested');
  assert.equal(db.appointments.find((a) => a.id === 'v-other').status, 'requested');
  assert.match(formatToolConfirmation(out.results, 'en'), /I've cancelled your Carpet cleaning on Friday/);
});
test('eval 2: another caller\'s appointmentId → no update, row untouched', async () => {
  const db = fakeDb(TWO_VISITS);
  const out = await run(db, { appointmentUpdate: { appointmentId: 'v-other', status: 'cancelled' }, trustCancelConfirmed: true }, { trustState: createBrainState({}) });
  assert.equal(out.results[0].code, 'not_callers_visit');
  assert.equal(db.appointments.find((a) => a.id === 'v-other').status, 'requested');
});
test('cancel: a no keeps the visit', () => {
  const state = createBrainState({});
  state.trust = { pendingCancel: { id: 'v-fri', label: 'Carpet cleaning on Friday' } };
  const plan = trust.planTrustTurn({ text: 'No, leave it', state, language: 'en' });
  assert.match(plan.line, /stays as it is/);
});
test('eval 20: vague "change my booking" → asks what to change, no write', async () => {
  const db = fakeDb([TWO_VISITS[0]]);
  const out = await run(db, { appointmentUpdate: { notes: 'caller wants a change' } }, { trustState: createBrainState({}), callerText: 'change my booking' });
  assert.equal(out.results[0].code, 'what_to_change');
  assert.match(formatToolConfirmation(out.results, 'en'), /day or the time/);
});
test('eval 14: "come to Kilimani instead" → address unchanged, owner callback task, honest line', async () => {
  const db = fakeDb([TWO_VISITS[0]]);
  const out = await run(db, { appointmentUpdate: { landmark: 'Kilimani' } }, { trustState: createBrainState({}), callerText: 'Can you come to Kilimani instead' });
  assert.equal(db.appointments[0].address_landmark, undefined);
  assert.equal(db.requests.length, 1);
  assert.match(db.requests[0].notes, /Kilimani/);
  assert.match(formatToolConfirmation(out.results, 'en'), /can't change the address on a call/);
});

// ---------------------------------------------------------------- P0-2
test('eval 3/4/5: dates', () => {
  const at = (t) => resolveAppointmentWhen(t, NOW);
  assert.equal(at('keshokutwa saa nne asubuhi').instant.toISOString(), '2026-10-16T07:00:00.000Z');
  assert.equal(at('leo saa 8').ok, false);
  assert.equal(at('leo saa nane mchana').instant.toISOString(), '2026-10-14T11:00:00.000Z');
  assert.equal(at('saa tatu kasoro robo asubuhi kesho').instant.toISOString(), '2026-10-15T05:45:00.000Z');
  assert.equal(at('wiki ijayo').ok, false);
  assert.equal(at('Jumatatu wiki ijayo saa tatu asubuhi').weekday, 'mon');
});
test('dates: read-back in both forms', () => {
  const label = require('../src/conversation/appointmentHours').formatRequestedWhenLabel({ resolved: resolveAppointmentWhen('Friday 10 am', NOW) }, 'en');
  assert.match(label, /Friday at 10 AM, that's saa nne asubuhi/i);
});

// ---------------------------------------------------------------- P0-3 / P0-4
test('eval 8: "Tunayo hiyo" / "in stock" without a catalogue match → dropped', () => {
  const st = createBrainState({});
  const out = trust.shapeSpeech('Yes, we have that book in stock. Tunayo hiyo.', { state: st, language: 'en' }).text;
  assert.doesNotMatch(out, /in stock|tunayo/i);
  assert.match(out, /confirm that with the owner/);
});
test('eval 9: SW success with no receipt → dropped', () => {
  const out = trust.shapeSpeech('Nimeweka booking yako kesho. Ziara yako imethibitishwa. Tumepanga fundi kesho.', { state: createBrainState({}), language: 'sw' }).text;
  assert.doesNotMatch(out, /Nimeweka|imethibitishwa|Tumepanga/);
});
test('eval 10: escalate receipt does not unlock "I\'ve booked your visit"', () => {
  const results = [{ action: 'escalate', status: 'succeeded', value: { reason: 'x' } }];
  const out = trust.shapeSpeech("I've booked your visit for Friday. I've passed your message on.", { state: createBrainState({}), toolResults: results }).text;
  assert.doesNotMatch(out, /booked/);
  assert.match(out, /passed your message/);
});
test('eval 11: three-item order read back in full', () => {
  const results = [{ action: 'create_service_request', status: 'succeeded', id: 'r1', value: { type: 'order', items: [{ item: 'diary', quantity: 2 }, { item: 'pen', quantity: 3 }, { item: 'ruler', quantity: 1 }] } }];
  const line = trust.receiptReadback(results, 'en');
  assert.match(line, /2 diary, 3 pen, 1 ruler/);
});
test('eval 15: enquiry summary is not "left a hold"; confirmed name only', () => {
  const s = createBrainState({});
  s.caller.name = 'Mmh'; s.caller.nameConfirmed = false;
  s.actions.savedWork = [{ action: 'create_service_request', status: 'succeeded', requestType: 'enquiry', value: { type: 'enquiry', item: 'carpet cleaning' } }];
  const sum = deriveCallSummary({ brainState: s });
  assert.doesNotMatch(sum.reason, /left a hold/);
  assert.match(sum.reason, /^Caller made an enquiry/);
});
test('eval 17: two questions → one survives', () => {
  const out = trust.shapeSpeech('Which day suits you? And which area are you in?', { state: createBrainState({}) }).text;
  assert.equal((out.match(/\?/g) || []).length, 1);
});
test('refund promise is never spoken', () => {
  const out = trust.shapeSpeech("We'll refund you in full.", { state: createBrainState({}) }).text;
  assert.doesNotMatch(out, /refund you/);
});

// ---------------------------------------------------------------- P1
test('P1-5 tenant required fields: one ask, volunteered details kept', () => {
  const s = createBrainState({});
  s.goal.primary = 'make_booking_request';
  s.entities.when = { value: 'kesho' };
  const profile = { requiredFields: { booking: ['service', 'when', 'location'] } };
  assert.deepEqual(ci.missingRequiredFields(profile, s), ['service', 'location']);
  assert.match(ci.requiredFieldHint(profile, s, 'en'), /Ask ONE now: "Which service do you need\?"/);
});
test('P1-6 costed save waits for one summary + yes', () => {
  const s = createBrainState({});
  const parsed = { appointment: { serviceName: 'Carpet cleaning', whenText: 'Friday 10 am', landmark: 'Kilimani' } };
  const gate = ci.gateCostedSave(parsed, { state: s, profile: {}, language: 'en', whenLabel: 'Friday at 10 AM' });
  assert.match(gate.line, /So that's Carpet cleaning, Friday at 10 AM, Kilimani\. Shall I save it\?/);
  const plan = trust.planTrustTurn({ text: 'Yes please', state: s, language: 'en' });
  assert.equal(plan.parsed.trustSaveConfirmed, true);
  assert.equal(ci.gateCostedSave(plan.parsed, { state: s, profile: {} }), null);
});
test('eval 6: repeat caller, same service same day → one appointment row', async () => {
  const db = fakeDb([TWO_VISITS[0]]);
  const value = { serviceName: 'Carpet cleaning', whenText: 'Friday 10 am', landmark: 'Kilimani', name: 'Wanjiru' };
  const out = await run(db, { appointment: value }, { trustState: createBrainState({}) });
  assert.equal(db.appointments.length, 1);
  assert.equal(out.results[0].status, 'duplicate');
  assert.match(formatToolConfirmation(out.results, 'en'), /already on file: Carpet cleaning on Friday/);
});
test('eval 7: same call, notes reworded → one service_request row', async () => {
  const db = fakeDb();
  const state = createBrainState({});
  const a = await run(db, { serviceRequest: { type: 'callback', name: 'Wanjiru', item: 'quote', notes: 'wants a quote' } }, { trustState: state });
  const fp = a.results.find((r) => r.fingerprint)?.fingerprint;
  await run(db, { serviceRequest: { type: 'callback', name: 'Wanjiru', item: 'quote', notes: 'asked for a quote please' } }, { trustState: state, completedFingerprints: [fp] });
  assert.equal(db.requests.length, 1);
});
test('eval 19: hold when_text changes only on a refinement', () => {
  const fn = require('../src/conversation/toolExecution').whenTextIsRefinement;
  assert.equal(fn('Saturday', 'maybe Friday'), false);
  assert.equal(fn('Saturday', 'Saturday 10 am'), true);
});
test('eval 12: complaint (SW and EN) → record + no promise', () => {
  for (const text of ['Mmeniletea kitu kibaya, sijaridhika', 'my order was wrong']) {
    const s = createBrainState({});
    const plan = trust.planTrustTurn({ text, state: s, language: /sijaridhika/.test(text) ? 'sw' : 'en' });
    assert.equal(plan.kind, 'apply', text);
    assert.equal(plan.parsed.serviceRequest.item, 'complaint');
    assert.equal(s.intent, 'complaint');
    assert.doesNotMatch(plan.line, /\bwill refund|tutakurudishia/i);
  }
});
test('eval 13: escalation dispatch fails → honest line names the saved callback', async () => {
  const db = fakeDb();
  const out = await run(db, { escalate: { reason: 'Wants the owner', name: 'Wanjiru' } }, { trustState: createBrainState({}) });
  const line = formatToolConfirmation(out.results, 'en');
  assert.doesNotMatch(line, /They'll call you back today/);
  assert.match(line, /saved a callback request/);
});
test('P1-9 handover note is structured', () => {
  const s = createBrainState({});
  s.caller.name = 'Wanjiru'; s.caller.nameConfirmed = true;
  s.entities.when = { value: 'kesho saa nne' };
  const note = ci.handoverNote({ state: s, phone: PHONE, reason: 'urgent leak' });
  assert.match(note, /^Caller: Wanjiru \(\+254712345678\), new/m);
  assert.match(note, /^Urgency: urgent/m);
  assert.match(note, /^Details: When kesho saa nne/m);
});
test('P1-10 phone read-back in 07xx xxx xxx chunks', () => {
  assert.equal(ci.chunkPhoneForSpeech('+254712345678'), '0 7 1 2, 3 4 5, 6 7 8');
});
test('P1-11 partial slots saved on hangup', () => {
  const s = createBrainState({});
  s.goal.primary = 'make_booking_request';
  s.entities.service = { value: 'Carpet cleaning' };
  s.entities.when = { value: 'Friday' };
  const req = ci.partialHangupRequest(s);
  assert.equal(req.type, 'callback');
  assert.match(req.notes, /service Carpet cleaning; when Friday/);
  assert.equal(ci.partialHangupRequest(s), null, 'once');
});
test('eval 16: SW caller SMS: Kiswahili, formatted day/time, GSM-7, ≤160', () => {
  const body = ci.callerSmsBody({ kind: 'caller_appointment', businessName: 'Biashara', item: 'Usafi wa zulia', windowStart: '2026-10-16T07:00:00Z' }, 'sw');
  assert.match(body, /Ijumaa saa nne asubuhi/);
  assert.ok(body.length <= 160);
  assert.equal(ci.toGsm7(body), body);
});
test('P2-12 caller SMS only after an in-call yes', async () => {
  const { dispatchCallerSms } = require('../src/notifications/callerSms');
  const out = await dispatchCallerSms({ to: PHONE, event: { kind: 'caller_appointment' }, channels: { caller_sms: true } });
  assert.equal(out.reason, 'no_in_call_yes');
  const s = createBrainState({});
  ci.noteSmsConsent(s, { lastAgentText: 'Saved. Shall I send you an SMS confirmation?', text: 'Yes' });
  assert.equal(s.trust.smsConsent, true);
});
test('flag off: module is inert', () => {
  process.env.CALLER_INFO_P1 = '';
  try {
    assert.equal(ci.guardSentence('We have it in stock.', {}), null);
    assert.equal(ci.chunkPhonesInText('0712345678'), '0712345678');
  } finally { process.env.CALLER_INFO_P1 = 'on'; }
});
