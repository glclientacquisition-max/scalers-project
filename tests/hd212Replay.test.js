'use strict';
// HD_212e49ef183f (staging b98f186e, 14 Oct 10:36 EAT) replayed through the
// Brain and the tool path: "something new" is an answer, the held Friday +
// "saa 4" reaches the save, a visit sent as create_service_request becomes
// create_appointment, the missing-slot line never re-asks the name, and no
// model instruction reaches the owner text.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRAIN_TRUST_P1 = 'on';
process.env.BRAIN_CALL_FIXES_D199 = 'on';

const trust = require('../src/conversation/trustP1');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { executeBrainTools, formatToolConfirmation } = require('../src/conversation/toolExecution');
const { stripInternal } = require('../src/conversation/internalText');
const events = require('../src/notifications/events');

const PROFILE = { servicesCatalog: [{ title: 'Interior Window Cleaning' }] };
const NOW = new Date('2026-10-14T07:37:00Z');

function replay() {
  let s = createBrainState(PROFILE);
  s.caller.name = 'Alvin';
  s.caller.nameConfirmed = true;
  const turn = (text, agent) => {
    s = observeCallerTurn(s, { text, entities: extractConversationEntities(text, { profile: PROFILE, state: s }), profile: PROFILE, lastAgentText: agent });
    return trust.planTrustTurn({ text, state: s, language: 'en', lastAgentText: agent });
  };
  s.trust = { ...(s.trust || {}), resume: { taskId: 'old-carpet', ttl: 2 } };
  const which = turn("I think it's something new", 'Is this about the carpet Cleaning (per room), or something new?');
  turn('I need to book window cleaning for Friday, and.', 'What would you like us to help with?');
  turn('Uh, around Kitengela.', 'Where should we come for the window cleaning on Friday?');
  // The live call held this from the model-side extractor (Railway log).
  s.entities.location = { value: 'around Kitengela', source: 'caller_explicit', confidence: 0.9 };
  turn('Saa 4', 'What time on Friday would you like us to come for the window cleaning in Kitengela?');
  return { s, which };
}

test('(4) "something new" / "kitu kipya" is an answer, not "Which request do you mean?"', () => {
  const { which } = replay();
  assert.ok(!which || which.kind !== 'which', JSON.stringify(which));
  const s = createBrainState({});
  s.trust = { resume: { taskId: 'x', ttl: 2 } };
  const sw = trust.planTrustTurn({ text: 'Ni kitu kipya', state: s, language: 'sw' });
  assert.ok(!sw || sw.kind !== 'which');
});

test('(1) the save gate uses the held day/time (Friday + saa 4)', () => {
  const { s } = replay();
  assert.match(String(s.entities.when.value), /Friday/i);
  assert.equal(trust.saveMissingSlot({ type: 'enquiry', item: 'Interior Window Cleaning' }, s), '');
});

test('(2) a visit sent as create_service_request is routed to create_appointment with held slots', async () => {
  const { s } = replay();
  const routed = trust.routeVisitRequest({ serviceRequest: { type: 'enquiry', item: 'Interior Window Cleaning', name: 'Alvin' } }, s, { createAppointment: true });
  assert.ok(routed.appointment && !routed.serviceRequest);
  assert.equal(routed.appointment.serviceName, 'Interior Window Cleaning');
  assert.match(routed.appointment.whenText, /Friday/i);
  assert.match(routed.appointment.landmark, /Kitengela/);
  // A callback / hold / order stays a service request.
  assert.equal(trust.routeVisitRequest({ serviceRequest: { type: 'callback', item: 'x' } }, s, { createAppointment: true }), null);
  // No visit tool for the tenant: not routed.
  assert.equal(trust.routeVisitRequest({ serviceRequest: { type: 'enquiry', item: 'x' } }, s, {}), null);
});

test('(3) trust_missing_slot asks the day/time, never the name, and does not repeat', async () => {
  const s = createBrainState({});
  s.caller.name = 'Alvin'; s.caller.nameConfirmed = true;
  const lines = [];
  for (let i = 0; i < 2; i += 1) {
    const out = await executeBrainTools({
      parsed: { serviceRequest: { type: 'enquiry', item: 'Interior Window Cleaning', name: 'Alvin', __trustMissingSlot: 'when_text' } },
      capabilities: { createServiceRequest: true },
      handlers: { createServiceRequest: async () => ({ id: 'r1' }) },
      nameConfirmed: true,
      heldCallerName: 'Alvin',
      trustState: s,
      now: NOW,
    });
    lines.push(formatToolConfirmation(out.results, 'en'));
  }
  for (const l of lines) {
    assert.doesNotMatch(l, /name|pick up|hold/i);
    assert.match(l, /day|time/i);
  }
  assert.notEqual(lines[0], lines[1]);
});

test('(5) no model instruction reaches the owner email / summary', () => {
  const leak = 'Slots are complete. Append create_appointment and speak nothing. Do not tell the caller it is booked; the backend speaks the outcome.';
  assert.equal(stripInternal(leak), '');
  assert.equal(stripInternal(`Alvin wants window cleaning on Friday. ${leak}`), 'Alvin wants window cleaning on Friday.');
  const ev = events.ownerLeadEvent({ name: 'Alvin', caller_number: '+254790381872', reason: 'Alvin asked about saa 4.', resolution_note: leak }, 'Biz');
  const blob = JSON.stringify(ev.fields);
  assert.doesNotMatch(blob, /append|speak nothing|backend|create_appointment|do not tell/i);
  const rendered = typeof events.renderOwnerText === 'function' ? events.renderOwnerText(ev) : blob;
  assert.doesNotMatch(String(rendered), /append|speak nothing|backend|create_appointment/i);
});
