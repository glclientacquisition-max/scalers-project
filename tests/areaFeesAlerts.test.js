'use strict';
// Area travel fees reach the voice brain (#667/#672 follow-up), answered-call
// lead titles, request footers by type, and enquiry results without D199.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readAreaTerms } = require('../src/conversation/areaTerms');
const { checkCoverage } = require('../src/conversation/gigo/factReaders');
const { runFactTool } = require('../src/conversation/gigo/factTools');
const { formatPoliciesBlock } = require('../src/conversation/businessPolicies');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { buildSystemPrompt } = require('../src/prompts');
const { ownerLeadEvent, serviceRequestEvent, renderEventText, renderEventSubject } = require('../src/notifications/events');
const { buildLeadText } = require('../src/notifications/whatsapp');
const { toolFlagsFromBrain, mergeTranscriptReview, alignFactsWithSavedWork, formatTrustedSnapshotForTests } = require('../src/conversation/callTranscriptReview');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

const area = (id, extra = {}) => ({ id, eta: 'Same day', modes: ['visit'], source: 'owner', confirmed: true, fee_mode: 'fixed', fee_ksh: 300, min_order_ksh: null, ...extra });
const jiraniAreas = {
  version: 1,
  reach: 'visit',
  areas: [
    area('place:kilimani', { fee_mode: 'free', fee_ksh: null }),
    area('place:kileleshwa'),
    area('place:karen', { eta: 'Next day', fee_ksh: 800 }),
    area('place:lavington', { source: 'import', confirmed: false }),
  ],
};
const policies = { coverage_areas: ['place:kilimani', 'place:kileleshwa', 'place:karen', 'place:lavington'] };
const profile = (extra = {}) => ({ vertical: 'home_services', businessPolicies: policies, areaTerms: readAreaTerms(jiraniAreas), ...extra });

test('check_coverage: the matched area carries its fee, time and mode', () => {
  const res = checkCoverage(profile(), 'Kileleshwa, near Valley Arcade', { language: 'en' });
  assert.equal(res.status, 'covered');
  assert.deepEqual(res.area, { name: 'Kileleshwa', mode: 'visit', fee_mode: 'fixed', fee_ksh: 300, eta: 'Same day', fee_confirmed: true });
  assert.match(res.say, /KSh 300/);
  assert.match(res.say, /travel fee/i);
  const sw = checkCoverage(profile(), 'Kileleshwa', { language: 'sw' });
  assert.match(sw.say, /shilingi 300/);
});

test('check_coverage: free area and unconfirmed fee never guess', () => {
  assert.match(checkCoverage(profile(), 'Kilimani', {}).say, /no travel fee/i);
  const lav = checkCoverage(profile(), 'Lavington', {});
  assert.equal(lav.area.fee_ksh, null);
  assert.equal(lav.area.fee_confirmed, false);
  assert.doesNotMatch(lav.say, /KSh/);
  assert.match(lav.say, /confirm the fee/i);
});

test('check_coverage tool returns the area terms in value', () => {
  const out = runFactTool('check_coverage', { place: 'Kileleshwa' }, profile(), { language: 'en' });
  assert.equal(out.status, 'covered');
  assert.equal(out.value.area.fee_ksh, 300);
  assert.match(out.say, /KSh 300/);
});

test('check_coverage: no saved terms keeps the old answer; outside areas (#672) unchanged', () => {
  const plain = checkCoverage({ businessPolicies: policies }, 'Kileleshwa', {});
  assert.equal(plain.status, 'covered');
  assert.equal(plain.area, undefined);
  const kenya = checkCoverage(
    profile({ businessPolicies: { ...policies, coverage_outside: { anywhere_kenya: true, fee_ksh: 1500 } } }),
    'Kisumu',
    {}
  );
  assert.equal(kenya.reason, 'anywhere_in_kenya');
  assert.match(kenya.say, /Kisumu/);
});

test('check_coverage: an unconfirmed coverage list in hash mode leaks no fee', () => {
  const prov = require('../src/conversation/provenance');
  const res = checkCoverage(profile({ fieldMeta: prov.indexFieldMeta([]) }), 'Kileleshwa', { hashMode: true });
  assert.equal(res.status, 'unknown');
  assert.equal(res.area, undefined);
});

test('Coverage line shows each area with its fee; fee is not pushed down', () => {
  const block = formatPoliciesBlock({ ...policies, delivery: 'We bring all supplies.' }, { areaTerms: readAreaTerms(jiraniAreas) });
  assert.match(block, /- Coverage: Kilimani \(no travel fee, same day\), Kileleshwa \(KSh 300 travel fee, same day\), Karen \(KSh 800 travel fee, next day\), Lavington \(fee confirmed on callback, same day\)/);
  assert.doesNotMatch(block, /Delivery text is timing/);
  assert.match(block, /fee/i);
});

test('live prompt from a tenants row carries the area fee', () => {
  const row = { id: 't1', business_name: 'Jirani', vertical: 'home_services', business_policies: policies, service_areas: jiraniAreas };
  const p = tenantProfileFromRow(row);
  assert.ok(p.areaTerms);
  assert.match(buildSystemPrompt(p), /Kileleshwa \(KSh 300 travel fee, same day\)/);
});

test('lead alert: answered call is a call lead, missed only when missed', () => {
  const answered = ownerLeadEvent({ status: 'completed', name: 'Chris', from_number: '+254700000000', reason: 'Deep clean' }, 'Jirani');
  assert.equal(renderEventSubject(answered), 'New call lead. Jirani');
  assert.match(renderEventText(answered), /^New call lead\. Jirani/);
  const missed = ownerLeadEvent({ status: 'no_answer', from_number: '+254700000000' }, 'Jirani');
  assert.equal(renderEventSubject(missed), 'New missed-call lead. Jirani');
  assert.match(buildLeadText({ businessName: 'Jirani', name: 'Chris' }), /^New call lead\. Jirani/);
  assert.match(buildLeadText({ businessName: 'Jirani', missed: true }), /^New missed-call lead\. Jirani/);
  assert.doesNotMatch(buildLeadText({ businessName: 'Jirani' }), /Missed call/);
});

test('request alert footer follows the request type', () => {
  const footer = (type) => serviceRequestEvent({ request_type: type, item: 'Deep clean' }, 'Jirani').action;
  assert.equal(footer('hold'), 'Open Inbox Holds to mark fulfilled.');
  assert.equal(footer('order'), 'Open Inbox Holds to fulfil the order.');
  assert.equal(footer('enquiry'), 'Open Inbox to call the customer back.');
  assert.equal(footer('callback'), 'Open Inbox to call the customer back.');
  assert.equal(footer('other'), 'Open Inbox to call the customer back.');
});

function enquiryState() {
  return recordActionResults(createBrainState({ vertical: 'home_services' }), [
    { action: 'create_service_request', status: 'succeeded', requestType: 'enquiry', value: { type: 'enquiry', item: 'Deep clean, 2 bedroom' } },
  ]);
}

test('enquiry row is an enquiry without BRAIN_CALL_FIXES_D199', () => {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  delete process.env.BRAIN_CALL_FIXES_D199;
  try {
    const flags = toolFlagsFromBrain(enquiryState());
    assert.equal(flags.enquirySaved, true);
    assert.equal(flags.holdKind, 'enquiry');
    assert.equal(flags.holdOpen, false);
    const snap = formatTrustedSnapshotForTests({ toolFlags: flags, derived: {}, summary: {} });
    assert.match(snap, /holdSaved: false/);
    assert.match(snap, /enquirySaved: true/);
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'order_enquiry', resolution: 'unresolved' },
      summary: {},
      toolFlags: flags,
      review: { reason: 'Chris left a hold.', want: 'Hold', done: 'Hold saved.', primary_intent: 'hold_or_pickup', confidence: 0.9, mood: 'calm' },
      vertical: 'home_services',
    });
    assert.equal(merged.reviewKind, 'order_enquiry');
    assert.match(merged.done, /^Enquiry saved: Deep clean, 2 bedroom\.$/);
    const facts = alignFactsWithSavedWork({ intent: 'hold_or_pickup', outcome: 'hold' }, flags);
    assert.equal(facts.outcome, 'callback');
    assert.notEqual(facts.intent, 'hold_or_pickup');
  } finally {
    if (prev === undefined) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  }
});

test('a real hold stays a hold; a saved visit is a visit request', () => {
  const hold = toolFlagsFromBrain(
    recordActionResults(createBrainState(), [{ action: 'create_service_request', status: 'succeeded', requestType: 'hold' }])
  );
  assert.equal(hold.enquirySaved, false);
  assert.equal(alignFactsWithSavedWork({ intent: 'hold_or_pickup', outcome: 'hold' }, hold).outcome, 'hold');
  const visit = toolFlagsFromBrain(
    recordActionResults(createBrainState({ vertical: 'home_services' }), [{ action: 'create_appointment', status: 'succeeded', appointmentStatus: 'requested' }])
  );
  const vf = alignFactsWithSavedWork({ intent: 'hold_or_pickup', outcome: 'hold' }, visit);
  assert.equal(vf.outcome, 'booking');
  assert.equal(vf.intent, 'book_visit');
});

test('Swahili area line says the timing in Swahili', () => {
  const AT = require('../src/conversation/areaTerms');
  const [a] = AT.readAreaTerms({ areas: [{ id: 'place:kileleshwa', eta: 'Same day', modes: ['visit'], source: 'owner', fee_ksh: 300, fee_mode: 'fixed', confirmed: true }] }).areas;
  const line = AT.coveredAreaLine(a, 'sw');
  assert.match(line, /shilingi 300/); assert.match(line, /siku hiyo hiyo/); assert.doesNotMatch(line, /same day/i);
  assert.match(AT.coveredAreaLine({ ...a, eta: 'Next day' }, 'sw'), /siku inayofuata/);
});
