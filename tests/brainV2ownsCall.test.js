// BRAIN_V2_OWNS_CALL (plan C3): unit tests for src/conversation/v2/ownsCall.js
// and its server.js wiring. The real media loop is covered by tests/v2OwnsCallE2e.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const O = require('../src/conversation/v2/ownsCall');
const CS = require('../src/conversation/v2/commitSafety');
const V2 = require('../src/conversation/v2');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function withEnv(vars, fn) {
  return async () => {
    const keep = {};
    for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
    try { await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  };
}
const LIVE_ON = { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live', BRAIN_V2_OWNS_CALL: 'on', BRAIN_V2_COMMIT_SAFETY: null, GEMINI_API_KEY: null };

test('flag: off by default; on only for 1/true/on/yes; it turns commit safety on with it', withEnv({ BRAIN_V2_OWNS_CALL: null, BRAIN_V2_COMMIT_SAFETY: null }, () => {
  assert.equal(O.ownsCallEnabled(), false);
  assert.equal(CS.commitSafetyEnabled(), false);
  for (const v of ['1', 'true', 'on', 'yes']) assert.equal(O.ownsCallEnabled({ BRAIN_V2_OWNS_CALL: v }), true);
  assert.equal(O.ownsCallEnabled({ BRAIN_V2_OWNS_CALL: 'off' }), false);
  assert.equal(CS.commitSafetyEnabled({ BRAIN_V2_OWNS_CALL: 'on' }), true);
  process.env.BRAIN_V2_OWNS_CALL = 'on';
  assert.equal(CS.commitSafetyEnabled(), true);
}));

for (const [lang, line] of [['en', "Sorry, I didn't catch that. Could you say it again?"], ['sw', 'Samahani, sijakusikia vizuri. Unaweza kurudia?']]) {
  test(`[${lang}] a v2 throw mid-turn gives the v2 repair template, never a throw and never an empty line`, async () => {
    const logs = [];
    const throwing = { run: async () => { throw new Error('boom'); }, getState: () => ({ lang }) };
    const r = await O.runOwnedTurn(throwing, { text: 'x' }, { log: (m) => logs.push(m) });
    assert.equal(r.line, line); assert.equal(r.repaired, 'throw'); assert.equal(r.end, false);
    assert.match(logs[0], /repair reason=throw err=boom/);
    const empty = await O.runOwnedTurn({ run: async () => ({ line: '  ' }), getState: () => null }, { text: 'x', langLock: lang });
    assert.equal(empty.line, line); assert.equal(empty.repaired, 'empty_line');
    const none = await O.runOwnedTurn({ run: async () => null, getState: () => ({ lang }) }, { text: 'x' });
    assert.equal(none.line, line); assert.equal(none.repaired, 'no_result');
  });
}

test('a good v2 turn passes through untouched, end signal included', async () => {
  const r = await O.runOwnedTurn({ run: async () => ({ line: 'Thank you for calling. Goodbye.', end: true, reason: 'caller_done', lang: 'en' }) }, {});
  assert.equal(r.line, 'Thank you for calling. Goodbye.'); assert.equal(r.end, true); assert.equal(r.reason, 'caller_done'); assert.equal(r.repaired, undefined);
});

test('a v2 booking writes through live handlers with v2Owned set, once, with the C1 key', withEnv(LIVE_ON, async () => {
  const plans = [];
  const live = createBrainV2Live({
    callSid: 'HD_unit_book',
    applyTools: async (parsed) => { plans.push(parsed); return { results: [{ action: 'create_appointment', status: 'succeeded', id: 'apt_1' }] }; },
  });
  const now = new Date();
  const a = await live.run({ text: 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', profile: DD, langLock: 'en' });
  assert.match(a.line, /Shall I book it\?$/);
  const b = await live.run({ text: 'Yes', profile: DD, langLock: 'en' });
  assert.match(b.line, /booked/);
  const appts = plans.filter((p) => p.appointment);
  assert.equal(appts.length, 1); assert.ok(appts[0].appointment.idempotencyKey.startsWith('HD_unit_book:'));
  void now;
}));

test('server wiring: owned v2 writes pass v2Owned to applyGeminiTools, which hands them to the executor with no guardToolPlan / ensureRequired*', () => {
  assert.match(SERVER, /applyTools: \(parsed\) => applyGeminiTools\(callKey, parsed, \{ v2Owned: true \}\)/);
  assert.match(SERVER, /async function applyGeminiTools\(callSid, parsed, toolOpts = \{\}\)/);
  assert.match(SERVER, /const enforcedParsed =\n\s+toolOpts\.v2Owned === true\n\s+\? parsed\n\s+: guardToolPlan\(\n\s+ensureRequiredEscalate\(\n\s+ensureRequiredCreateRequest\(parsed, state, capabilities\)/);
  // the v1 old-path request de-dupe (type + item, quantity ignored) is skipped for v2 writes
  assert.match(SERVER, /if \(owedConfirmFoldEnabled\(\) && toolOpts\.v2Owned !== true\) \{\n\s+const dup = findDuplicateServiceRequest/);
  // v1's own applyGeminiTools callers are unchanged (no third argument)
  assert.match(SERVER, /applyGeminiTools\(callKey, rescue\.parsed\)/);
  assert.match(SERVER, /return await applyGeminiTools\(callSid, parsed\);/);
});

test('server wiring: the owned v2 turn returns before any v1 path, and skips the v1 file gate', () => {
  const i = SERVER.indexOf('if (v2Owns) {');
  const j = SERVER.indexOf('const lookupPlan = planLookupTurn(');
  assert.ok(i > 0 && j > i, 'owned block sits before the v1 lookup / local / Gemini paths');
  const block = SERVER.slice(i, SERVER.indexOf('\n      if (v2Live) {', i));
  assert.match(block, /skipFileGate: true/);
  assert.match(block, /v2OwnsCall\.runOwnedTurn\(/);
  assert.ok(!/using v1/.test(block), 'no v1 fallthrough in the owned block');
  assert.ok(block.trimEnd().endsWith('return;\n      }') || /\n        return;\n      }$/.test(block.trimEnd()), 'the owned block always returns');
  assert.match(block, /ownedV2Calls\.markEnded\(callKey/);
  // Flag off: the #849 block (v1 fallthrough) is still there.
  assert.match(SERVER, /brain_v2_live failed, using v1/);
});

test('server wiring: no turn re-opens after v2 ended (runCallerTurn guard), finishCall at hangup', () => {
  const rc = SERVER.slice(SERVER.indexOf('async function runCallerTurn('), SERVER.indexOf('async function runCallerTurn(') + 1500);
  assert.match(rc, /ownedV2Calls\.ended\(sidLabel\(\)\)/);
  assert.match(SERVER, /async function markCallTerminalFromWebhook\(args\) \{\n  finishOwnedV2Call\(args\?\.callSid/);
});

test('finishCall runs exactly once per call: double hangup, reconnect and a second terminal webhook get the cached result', withEnv(LIVE_ON, async () => {
  const calls = O.createOwnedCalls();
  let made = 0;
  const make = () => { made += 1; return createBrainV2Live({ callSid: 'HD_unit_fin', applyTools: async () => ({ results: [] }) }); };
  const live = calls.live('HD_unit_fin', make, { businessName: 'Done and Dusted' });
  assert.equal(calls.finish('HD_unit_fin'), null, 'no turn yet: nothing to finish');
  await live.run({ text: 'What are your hours?', profile: DD, langLock: 'en' });
  // reconnect: the same runner comes back, the state is kept
  assert.equal(calls.live('HD_unit_fin', make), live); assert.equal(made, 1);
  const first = calls.finish('HD_unit_fin', calls.meta('HD_unit_fin'));
  assert.equal(first.once, true); assert.equal(first.outcome, 'answered');
  const second = calls.finish('HD_unit_fin', {});
  assert.equal(second.once, false); assert.equal(second.outcome, 'answered');
  assert.equal(calls.stats().finishRuns, 1);
  assert.equal(calls.getLive('HD_unit_fin'), null, 'runner freed after the finish');
}));

test('finish feeds A4: v2 write receipts and the outcome go into the summary patch; a failed write is not booked', withEnv(LIVE_ON, async () => {
  const calls = O.createOwnedCalls();
  const live = calls.live('HD_unit_fail', () => createBrainV2Live({
    callSid: 'HD_unit_fail',
    applyTools: async (parsed) => ({ results: parsed.appointment ? [{ action: 'create_appointment', status: 'failed' }] : [{ action: 'escalate', status: 'succeeded', id: 'esc_1' }] }),
  }));
  await live.run({ text: 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', profile: DD, langLock: 'en' });
  const r = await live.run({ text: 'Yes', profile: DD, langLock: 'en' });
  assert.match(r.line, /couldn't save that/);
  const fin = calls.finish('HD_unit_fail', { businessName: 'Done and Dusted' });
  assert.equal(fin.outcome, 'write_failed');
  const patch = O.summaryPatch(fin).brain_v2;
  assert.equal(patch.outcome, 'write_failed');
  assert.deepEqual(patch.write_receipts.map((x) => x.phase), ['proposed', 'confirmed', 'failed']);
  assert.ok(patch.write_receipts.every((x) => x.idempotencyKey && x.idempotencyKey.startsWith('HD_unit_fail:')));
  assert.equal(O.summaryPatch(null), null);
}));

// C1 place guards with only BRAIN_V2_OWNS_CALL on (it turns commit safety on).
async function talk(lines) {
  const handlers = {
    createAppointment: async () => ({ id: 'apt_1', ok: true }),
    createServiceRequest: async () => ({ id: 'sr_1', ok: true }),
    escalate: async () => ({ ok: true, id: 'esc_1' }),
    saveCallerInfo: async () => ({ ok: true }),
    updateAppointment: async (u) => ({ id: u.appointmentId, ok: true }),
  };
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], callId: 'HD_unit_place' });
  const out = [];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile: DD, now: new Date('2026-10-14T05:00:00Z'), handlers }));
  return out;
}
test('C1 place guards apply with BRAIN_V2_OWNS_CALL on alone: a phone number, a sentence or a name-answer is not the place', withEnv({ BRAIN_V2_OWNS_CALL: 'on', BRAIN_V2_COMMIT_SAFETY: null }, async () => {
  const a = await talk(["I'd like to schedule sofa cleaning on Friday at 10am.", 'Also, my other number is 0712 345 678.']);
  assert.match(a[1].line, /^Where should we come\?/);
  const b = await talk(['Uh, book sofa cleaning Friday at 10am.', 'Kitengela', 'Ngong.', 'Njeri.']);
  assert.match(b[3].line, /in Kitengela, for Njeri\. Shall I book it\?$/);
  const c = await talk(['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Eeh...']);
  assert.ok(!/booked/.test(c[1].line), c[1].line);
}));
