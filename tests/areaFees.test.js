'use strict';
// Area fees from Settings › Locations (tenants.service_areas, #667/#672) reach
// the voice brain: the prompt's Coverage line, the coverage check and the old
// brain's local coverage answer. Only an owner-confirmed fee is spoken; any
// other fee is "confirmed on callback". Home services say "travel fee", shops
// say "delivery fee". The production speech check must keep a confirmed fee
// (KSh 300 for Kileleshwa) whether the model reads it from the prompt or the
// line comes from the coverage lookup, and must still strip an unconfirmed one.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readAreaTerms } = require('../src/conversation/areaTerms');
const { checkCoverage } = require('../src/conversation/gigo/factReaders');
const { runFactTool } = require('../src/conversation/gigo/factTools');
const { formatPoliciesBlock } = require('../src/conversation/businessPolicies');
const { coverageAskSpeech } = require('../src/conversation/visitLocation');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { createBrainState } = require('../src/conversation/brainState');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { buildSystemPrompt } = require('../src/prompts');

const area = (id, extra = {}) => ({
  id, eta: 'Same day', modes: ['visit'], source: 'owner', confirmed: true,
  fee_mode: 'fixed', fee_ksh: 300, min_order_ksh: null, ...extra,
});

// Delivery text names no fee, so the only place KSh 300 lives is Locations.
const homeRow = {
  id: 't-home', business_name: 'Jirani Test', vertical: 'home_services',
  business_policies: {
    coverage_areas: ['place:kilimani', 'place:kileleshwa', 'place:karen', 'place:lavington'],
    delivery: 'We bring all supplies.',
  },
  service_areas: {
    version: 1, reach: 'visit',
    areas: [
      area('place:kilimani', { fee_mode: 'free', fee_ksh: null }),
      area('place:kileleshwa'),
      area('place:karen', { eta: 'Next day', fee_ksh: 800 }),
      area('place:lavington', { source: 'import', confirmed: false, fee_ksh: 450 }),
    ],
  },
};
const shopRow = {
  id: 't-shop', business_name: 'Shop Test', vertical: 'retail',
  business_policies: { coverage_areas: ['place:westlands', 'place:kilimani', 'place:karen'] },
  service_areas: {
    version: 1, reach: 'deliver',
    areas: [
      area('place:westlands', { modes: ['delivery'], fee_ksh: 200, eta: 'Next day' }),
      area('place:kilimani', { modes: ['delivery'], fee_mode: 'free', fee_ksh: null }),
      area('place:karen', { modes: ['delivery'], fee_mode: 'ask', fee_ksh: null }),
    ],
  },
};
const home = () => tenantProfileFromRow(homeRow);
const shop = () => tenantProfileFromRow(shopRow);

function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  try { return fn(); } finally {
    if (before == null) delete process.env[name];
    else process.env[name] = before;
  }
}
const quiet = (fn) => { const w = console.warn; const l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };

// ---------------------------------------------------------------- prompt

test('prompt Coverage line: home services say travel fee; unconfirmed is confirmed on callback', () => {
  const prompt = buildSystemPrompt(home());
  assert.match(prompt, /Kileleshwa \(KSh 300 travel fee, same day\)/);
  assert.match(prompt, /Kilimani \(no travel fee, same day\)/);
  assert.match(prompt, /Karen \(KSh 800 travel fee, next day\)/);
  assert.match(prompt, /Lavington \(travel fee confirmed on callback, same day\)/);
  assert.doesNotMatch(prompt, /450/);
});

test('prompt Coverage line: shops say delivery fee', () => {
  const block = formatPoliciesBlock(shopRow.business_policies, { areaTerms: shop().areaTerms });
  assert.match(block, /Westlands \(KSh 200 delivery fee, next day\)/);
  assert.match(block, /Kilimani \(no delivery fee/);
  assert.match(block, /Karen \(delivery fee confirmed on callback, same day\)/);
  assert.doesNotMatch(block, /travel fee/);
});

test('no Locations terms: the Coverage line is the old plain list', () => {
  const block = formatPoliciesBlock(homeRow.business_policies, { areaTerms: null });
  assert.match(block, /- Coverage: Kilimani, Kileleshwa, Karen, Lavington/);
  assert.equal(readAreaTerms(null), null);
});

// ---------------------------------------------------------------- coverage check

test('coverage check: confirmed fee in both languages; free; unconfirmed goes to callback', () => {
  const en = checkCoverage(home(), 'Kileleshwa, near Valley Arcade', { language: 'en' });
  assert.equal(en.status, 'covered');
  assert.equal(en.area.fee_ksh, 300);
  assert.match(en.say, /The travel fee there is KSh 300\./);
  assert.match(checkCoverage(home(), 'Kileleshwa', { language: 'sw' }).say, /Ada ya usafiri ni shilingi 300\./);
  assert.match(checkCoverage(home(), 'Kilimani', {}).say, /There is no travel fee\./);
  const lav = checkCoverage(home(), 'Lavington', { language: 'en' });
  assert.equal(lav.area.fee_ksh, null);
  assert.equal(lav.area.fee_confirmed, false);
  assert.doesNotMatch(lav.say, /KSh|450/);
  assert.match(lav.say, /The team will confirm the travel fee when they call you back\./);
  assert.match(checkCoverage(shop(), 'Westlands', {}).say, /The delivery fee there is KSh 200\./);
  assert.match(checkCoverage(shop(), 'Karen', { language: 'sw' }).say, /Timu itakuthibitishia ada ya delivery/);
});

test('check_coverage tool returns the area terms', () => {
  const out = runFactTool('check_coverage', { place: 'Kileleshwa' }, home(), { language: 'en' });
  assert.equal(out.status, 'covered');
  assert.equal(out.value.area.fee_ksh, 300);
  assert.match(out.say, /KSh 300/);
});

// ---------------------------------------------------------------- old brain local answer

test('old brain coverage answer speaks the confirmed travel fee (en, sw)', () => {
  const en = coverageAskSpeech('Do you cover Kileleshwa?', home(), 'en');
  assert.match(en, /^Yes, we cover Kileleshwa\. The travel fee there is KSh 300\./);
  const sw = coverageAskSpeech('Mnafika Kileleshwa?', home(), 'sw');
  assert.match(sw, /^Ndiyo, tunafika Kileleshwa\. Ada ya usafiri ni shilingi 300\./);
  const lav = coverageAskSpeech('Do you cover Lavington?', home(), 'en');
  assert.match(lav, /The team will confirm the travel fee when they call you back\./);
  assert.doesNotMatch(lav, /KSh|450/);
  assert.match(coverageAskSpeech('Do you cover Kilimani?', home(), 'en'), /There is no travel fee\./);
});

test('old brain coverage answer without Locations terms is unchanged', () => {
  const plain = { ...home(), areaTerms: null };
  assert.match(coverageAskSpeech('Do you cover Kileleshwa?', plain, 'en'), /^Yes, we cover Kileleshwa\. (?!The travel fee)/);
});

// ---------------------------------------------------------------- production speech check

const ASK_EN = 'Do you come to Kileleshwa? How much is the transport?';
const ASK_SW = 'Mnafika Kileleshwa? Usafiri ni pesa ngapi?';

function guard(text, profile, callerTurns, extra = {}) {
  return quiet(() => guardSpokenReply(text, { profile, callerTurns, toolResults: [], language: extra.language || 'en', state: createBrainState({ vertical: profile.vertical }), ...extra }));
}

for (const d199 of [undefined, 'on']) {
  const label = d199 ? 'D199 on' : 'D199 off';
  test(`speech check keeps a confirmed fee the model read from the prompt (${label})`, () => withEnv('BRAIN_CALL_FIXES_D199', d199, () => {
    const p = home();
    const en = 'Yes, we come to Kileleshwa. The travel fee there is KSh 300.';
    assert.equal(guard(en, p, [ASK_EN]), en);
    const glued = 'Yes, we come to Kileleshwa. The travel fee is KSh300.';
    assert.match(guard(glued, p, [ASK_EN]), /KSh ?300/);
    const sw = 'Ndiyo, tunafika Kileleshwa. Ada ya usafiri ni shilingi 300.';
    assert.equal(guard(sw, p, [ASK_SW], { language: 'sw' }), sw);
    const karen = 'Karen is KSh 800 travel fee, and we come the next day.';
    assert.match(guard(karen, p, ['Do you go to Karen?']), /KSh 800/);
  }));

  test(`speech check keeps the coverage lookup's fee line (${label})`, () => withEnv('BRAIN_CALL_FIXES_D199', d199, () => {
    const p = home();
    const local = coverageAskSpeech('Do you cover Kileleshwa?', p, 'en');
    assert.match(guard(local, p, ['Do you cover Kileleshwa?']), /The travel fee there is KSh 300\./);
    const localSw = coverageAskSpeech('Mnafika Kileleshwa?', p, 'sw');
    assert.match(guard(localSw, p, ['Mnafika Kileleshwa?'], { language: 'sw' }), /shilingi 300/);
    const tool = runFactTool('check_coverage', { place: 'Kileleshwa' }, p, { language: 'en' });
    assert.match(guard(tool.say, p, [ASK_EN], { toolResults: [tool] }), /KSh 300/);
  }));

  test(`speech check still strips an unconfirmed fee (${label})`, () => withEnv('BRAIN_CALL_FIXES_D199', d199, () => {
    const out = guard('The travel fee to Lavington is KSh 450.', home(), ['How much to come to Lavington?']);
    assert.doesNotMatch(out, /450/);
  }));

  test(`final polish keeps the confirmed fee (${label})`, () => withEnv('BRAIN_CALL_FIXES_D199', d199, () => {
    const p = home();
    const out = quiet(() => polishSpokenDetail('Yes, we come to Kileleshwa. The travel fee there is KSh 300.', {
      profile: p, state: createBrainState({ vertical: 'home_services' }), callerTurns: [ASK_EN], toolResults: [], language: 'en',
    }));
    assert.match(out.text, /KSh 300/);
    assert.deepEqual(out.dropReasons, []);
  }));
}
