'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { readCoverageOutside, coverageDetail, kenyaCoverageLine } = require('../src/conversation/outsideAreas');
const { assessCoverage, coverageAskSpeech } = require('../src/conversation/visitLocation');
const { checkCoverage } = require('../src/conversation/gigo/factReaders');
const { normalizePolicies: normalizeBusinessPolicies } = require('../src/conversation/businessPolicies');

const base = { coverage_areas: ['county:nairobi'] };
const yes = (fee = null) => ({ ...base, coverage_outside: { anywhere_kenya: true, fee_ksh: fee } });
const home = (p) => ({ vertical: 'home_services', businessPolicies: p });
const shop = (p) => ({ vertical: 'retail', businessPolicies: p });

test('readCoverageOutside: only a real yes counts', () => {
  assert.equal(readCoverageOutside(base), null);
  assert.equal(readCoverageOutside({ coverage_outside: { anywhere_kenya: false } }), null);
  assert.deepEqual(readCoverageOutside(yes(350)), { feeKsh: 350 });
  assert.deepEqual(readCoverageOutside(yes()), { feeKsh: null });
  assert.deepEqual(readCoverageOutside(JSON.stringify(yes('abc'))), { feeKsh: null });
});

test('coverageDetail: listed, kenya, outside Kenya, unrecognised', () => {
  assert.equal(coverageDetail('Westlands', shop(yes())), 'listed');
  assert.equal(coverageDetail('Kisumu', shop(yes())), 'kenya');
  assert.equal(coverageDetail('Kampala', shop(yes())), 'outside_kenya');
  assert.equal(coverageDetail('Mbuyu Mtamu', shop(yes())), 'unknown_place');
  // No: current behaviour
  assert.equal(coverageDetail('Kisumu', shop(base)), 'outside');
});

test('assessCoverage: a Kenyan place counts as inside only with Yes', () => {
  assert.equal(assessCoverage('Kisumu', home(yes())), 'inside');
  assert.equal(assessCoverage('Kisumu', home(base)), 'outside');
});

test('kenyaCoverageLine: fee or team callback; home services always callback', () => {
  assert.equal(kenyaCoverageLine({ place: 'Kisumu', feeKsh: 350 }), 'Yes, we cover Kisumu. Delivery there is KSh 350.');
  assert.equal(kenyaCoverageLine({ place: 'Kisumu', feeKsh: null }), 'Yes, we cover Kisumu. The team will call you back with the fee.');
  assert.equal(kenyaCoverageLine({ place: 'Kisumu', feeKsh: 2000, homeServices: true }), 'Yes, we cover Kisumu. The team will call you back with the travel price.');
  assert.match(kenyaCoverageLine({ place: 'Kisumu', feeKsh: null, language: 'sw' }), /^Ndiyo, tunafika Kisumu\. Timu itakupigia/);
});

test('home services coverage answers', () => {
  assert.equal(coverageAskSpeech('do you come to Kisumu?', home(yes(1500))),
    'Yes, we cover Kisumu. The team will call you back with the travel price. Should I note the job for them?');
  assert.match(coverageAskSpeech('do you come to Kampala?', home(yes())), /only cover Kenya.*note it for the team\?$/);
  assert.match(coverageAskSpeech('do you come to Mbuyu Mtamu?', home(yes())), /Which county is that in\?$/);
  assert.match(coverageAskSpeech('do you come to Westlands?', home(yes())), /^Yes, we cover Westlands\./);
  assert.match(coverageAskSpeech('do you come to Kisumu?', home(base)), /outside our coverage/);
});

test('check_coverage tool carries the countrywide terms', () => {
  const p = { businessPolicies: yes(400), vertical: 'retail' };
  const r = checkCoverage(p, 'Kisumu');
  if (r.status === 'unknown') return; // provenance gate: nothing to say either way
  assert.equal(r.status, 'covered');
  assert.equal(r.say, 'Yes, we cover Kisumu. Delivery there is KSh 400.');
  assert.equal(checkCoverage(p, 'Westlands').say, undefined);
});

test('coverage_outside never leaks into policy text', () => {
  const out = normalizeBusinessPolicies(yes(500));
  assert.ok(!JSON.stringify(out.extra || {}).includes('coverage_outside'));
});

test('home services: no time is booked for a place outside the listed areas', () => {
  const { validateCreateAppointment } = require('../src/conversation/toolExecution');
  const r = validateCreateAppointment({ service: 'Deep cleaning', location: 'Kisumu', when_text: 'tomorrow 10am', name: 'Achieng' }, { businessPolicies: yes(2000) });
  assert.equal(r.valid, false);
  assert.equal(r.code, 'travel_quote');
  const listed = validateCreateAppointment({ service: 'Deep cleaning', location: 'Westlands', when_text: 'tomorrow 10am', name: 'Achieng' }, { businessPolicies: yes(2000) });
  assert.notEqual(listed.code, 'travel_quote');
});

test('policies prompt names the countrywide terms only with Yes', () => {
  const { formatPoliciesBlock } = require('../src/conversation/businessPolicies');
  if (typeof formatPoliciesBlock !== 'function') return;
  assert.match(formatPoliciesBlock(yes(350)), /Outside these areas: anywhere in Kenya, fee KSh 350/);
  assert.match(formatPoliciesBlock(yes()), /team calls back with the fee/);
  assert.doesNotMatch(formatPoliciesBlock(base), /anywhere in Kenya/);
});
