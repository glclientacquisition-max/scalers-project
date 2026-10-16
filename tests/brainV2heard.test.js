'use strict';
// BA v2: D&D-only shadow allowlist, heard-audio metrics, sentence splitting, cut-off turns, "outside Nairobi".
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const H = require('../evals/v2/lib/heard');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-14T05:00:00Z');
const DD_STAGING = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
async function call(lines) {
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] }); const h = V2.createDryRunHandlers(); const out = [];
  for (const text of lines) { const ev = []; for await (const e of V2.runTurnStream(st, { text, profile: DD, now: NOW, handlers: h })) ev.push(e); out.push({ c: text, ev, said: ev.filter((e) => e.type === 'sentence').map((e) => e.text).join(' ') }); }
  return out;
}

test('BRAIN_V2_SHADOW: off by default; BRAIN_V2_TENANTS scopes it to listed tenants only', () => {
  assert.equal(V2.brainV2ShadowEnabled({ env: {}, tenantId: DD_STAGING }), false);
  assert.equal(V2.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: '1' }, tenantId: 'any' }), true, 'unset allowlist = no restriction (matches Voice v2Shadow.js)');
  const env = { BRAIN_V2_SHADOW: '1', BRAIN_V2_TENANTS: DD_STAGING };
  assert.equal(V2.brainV2ShadowEnabled({ env, tenantId: DD_STAGING }), true);
  assert.equal(V2.brainV2ShadowEnabled({ env, tenantId: DD_STAGING.toUpperCase() }), true, 'case-insensitive uuid');
  assert.equal(V2.brainV2ShadowEnabled({ env, tenantId: 'other-tenant' }), false);
  assert.equal(V2.brainV2ShadowEnabled({ env, tenantId: undefined }), false, 'unknown tenant never shadows when a list is set');
  assert.equal(V2.brainV2ShadowEnabled({ env: { ...env, BRAIN_V2_TENANTS: ` ${DD_STAGING} , x ,` }, tenantId: DD_STAGING }), true, 'whitespace/trailing comma tolerated');
  assert.equal(V2.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: '0', BRAIN_V2_TENANTS: DD_STAGING }, tenantId: DD_STAGING }), false);
  assert.deepEqual(V2.tenantAllowlist({ BRAIN_V2_TENANTS: '' }), []);
  assert.equal(V2.brainV2Enabled({ env: { BRAIN_V2: 'on', BRAIN_V2_TENANTS: DD_STAGING }, tenantId: 'x' }), false);
});

test('splitSentences: no fragments from numbers or abbreviations', () => {
  assert.deepEqual(V2.splitSentences('Friday at 4.30 pm. Shall I book it?'), ['Friday at 4.30 pm.', 'Shall I book it?']);
  assert.deepEqual(V2.splitSentences('We are at St. Mary road. Ok?'), ['We are at St. Mary road.', 'Ok?']);
  assert.deepEqual(V2.splitSentences('Sawa. Uko wapi?'), ['Sawa.', 'Uko wapi?']);
});

test('heard metrics: fragments, repeats, ack-led, filler-only, language and tool gaps', () => {
  assert.equal(H.isFragment('Hapana, n'), true);
  assert.equal(H.isFragment('We serve Kitengela'), true, 'no terminal stop = cut off');
  assert.equal(H.isFragment('Nithibitishe?'), false);
  assert.equal(H.isFragment('Yes.'), false);
  const s = (text, atMs, lang = 'en') => ({ type: 'sentence', text, atMs, lang });
  const calls = [[
    { c: 'Hi, I want to book', ev: [s('Where should we come?', 1)] },
    { c: 'Kitengela', ev: [s('Where should we come?', 1)] },
    { c: 'ok', ev: [s('Okay.', 1), s('Hapana, n', 2, 'sw')] },
    { c: 'yes', ev: [{ type: 'tool', phase: 'start', name: 'createAppointment', write: true, atMs: 0 }, { type: 'tool', phase: 'end', name: 'createAppointment', write: true, atMs: 40, toolMs: 40 }, s('Done, your sofa cleaning is booked.', 90)] },
    { c: 'thanks', ev: [s('Sawa.', 1)] },
  ]];
  const m = H.scoreHeard(calls, { langOfCall: () => 'en' });
  assert.equal(m.repeatedTurns, 1); assert.equal(m.fragments, 1); assert.equal(m.fillerOnlyTurns, 1);
  assert.equal(m.toolTurns, 1); assert.equal(m.postToolGapMsP95, 50); assert.equal(m.toolTurnFirstSentenceMsP95, 90);
  assert.ok(m.ackLedRate > 0);
});

test('"outside Nairobi": answered from the tenant list, EN and SW; unlisted place offers one callback', async () => {
  const en = await call(['Do you work outside Nairobi?', 'Kitengela']);
  assert.match(en[0].said, /^Yes, outside Nairobi we serve Kitengela/); assert.doesNotMatch(en[0].said, /Nairobi is on our list/);
  assert.match(en[1].said, /Kitengela is on our list/);
  const sw = await call(['Mnafanya kazi nje ya Nairobi?', 'Machakos']);
  assert.match(sw[0].said, /nje ya Nairobi tunahudumia/); assert.doesNotMatch(sw[0].said, /Tuko wazi/);
  assert.match(sw[1].said, /Machakos haiko/);
  // Thika is inside Kiambu County (a listed county), so the unlisted example is Nakuru
  const un = await call(['Do you serve outside Nairobi? I am in Nakuru']);
  assert.match(un[0].said, /Nakuru isn't on our list/);
  const hrs = await call(['Mnafanya kazi saa ngapi?']);
  assert.match(hrs[0].said, /Tuko wazi/);
});

test('cut-off turns ("Hapana, n") never fill a slot, decline, or end the call; the open question is re-asked', async () => {
  const sw = await call(['Nataka kubook sofa cleaning kesho saa nne asubuhi', 'Hapana, n', 'Ruiru', 'Otieno', 'Ndio']);
  assert.match(sw[1].said, /^Samahani.*Tuje wapi\?$/);
  assert.match(sw[3].said, /Ruiru, kwa Otieno/); assert.match(sw[4].said, /ombi lako la Sofa Cleaning/);
  const en = await call(['Hi, I want to book sofa cleaning tomorrow at 10am', 'Kitengela', 'Alvin', 'No, w', 'Yes']);
  assert.match(en[3].said, /^Sorry/); assert.match(en[4].said, /sent your request/);
  assert.equal(V2.nlu.extractName('Kitengela', { prompted: true }), null, 'a bare area is not a name');
  assert.equal(V2.nlu.extractName('Karen', { prompted: true }), 'Karen');
});
