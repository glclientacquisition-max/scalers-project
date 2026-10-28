'use strict';
// Shared contract isKbLive (src/knowledge/kb/kbLive.js): the one "this business is on the KB" rule for Voice and Desk.
// Proves Voice's brain selector (kb/live.js decision / attach) makes the same decisions as before the contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isKbLive, kbGateOn, kbLiveFacts, KB_LIVE_COLUMNS } = require('../src/knowledge/kb/kbLive');
const LIVE = require('../src/knowledge/kb/live');
const STAGING = require('./fixtures/kb/kbLiveStaging.json').tenants;

// ---- the selector exactly as it was at f6557e8e (pre-contract), for parity
const OLD_ON = /^(1|true|on|yes)$/i;
const oldGateOn = (env) => OLD_ON.test(String(env.BRAIN_KB_GATE || '').trim());
const oldIsReady = ({ version, readyVersion, brainTarget }) => version != null && readyVersion != null && Number(version) === Number(readyVersion) && String(brainTarget || 'v2') === 'v2';
function oldDecision(env, tenantId, reg) {
  if (!oldGateOn(env)) return null;
  if (tenantId == null) return false;
  const r = reg.get(String(tenantId).toLowerCase());
  return !!(r && r.ready);
}
// old loadKbLive -> attach info (src/db.js): brainTarget defaults to 'v2', readyVersion ?? null
const loadShape = (t) => (t ? { version: t.kb_live_version, readyVersion: t.kb_ready_version ?? null, brainTarget: t.brain_target || 'v2' } : null);

const GATES = [undefined, '', 'off', '0', 'false', 'no', 'on', 'ON', ' on ', '1', 'true', 'yes', 'maybe'];
const FACTS = [];
for (const live of [null, 0, 1, 2, '2']) for (const ready of [null, 0, 1, 2, '2']) for (const target of [null, 'v2', 'v1']) FACTS.push({ kb_live_version: live, kb_ready_version: ready, brain_target: target });

test('gate off (unset / off / 0 / false / garbage) = kill switch: gate_off, selector returns null', () => {
  for (const g of [undefined, null, '', 'off', '0', 'false', 'no', 'maybe', false]) {
    assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2, brain_target: 'v2' }, { gate: g }), { live: false, reason: 'gate_off' });
  }
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2 }), { live: false, reason: 'gate_off' }, 'no gate passed = off (never reads env)');
  LIVE._REG.clear();
  LIVE.attach({ id: 'T-OFF' }, { version: 2, readyVersion: 2, brainTarget: 'v2', doc: null }, { env: {} });
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'off' }, tenantId: 'T-OFF' }), null);
  assert.equal(LIVE.decision({ env: {}, tenantId: 'T-OFF' }), null);
});

test('gate on + ready: live, reason ready (snake row, camel load shape, boolean or string gate)', () => {
  for (const g of [true, 'on', 'ON', ' on ', '1', 'true', 'yes']) {
    assert.deepEqual(isKbLive({ kb_live_version: 3, kb_ready_version: 3, brain_target: 'v2' }, { gate: g }), { live: true, reason: 'ready' });
  }
  assert.deepEqual(isKbLive({ version: 3, readyVersion: 3, brainTarget: 'v2' }, { gate: 'on' }), { live: true, reason: 'ready' });
  assert.deepEqual(isKbLive({ kb_live_version: 3, kb_ready_version: 3, brain_target: null }, { gate: 'on' }), { live: true, reason: 'ready' }, 'null target = v2 default');
  LIVE._REG.clear();
  LIVE.attach({ id: 'T-ON' }, { version: 3, readyVersion: 3, brainTarget: 'v2', doc: null }, { env: { BRAIN_KB_GATE: 'on' } });
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'on' }, tenantId: 't-on' }), true);
});

test('gate on + not ready: never_ready, ready_stale, no_live_version, no_facts', () => {
  const on = { gate: 'on' };
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: null, brain_target: 'v2' }, on), { live: false, reason: 'never_ready' });
  assert.deepEqual(isKbLive({ kb_live_version: 3, kb_ready_version: 2, brain_target: 'v2' }, on), { live: false, reason: 'ready_stale' });
  assert.deepEqual(isKbLive({ kb_live_version: null, kb_ready_version: null, brain_target: 'v2' }, on), { live: false, reason: 'no_live_version' });
  assert.deepEqual(isKbLive(null, on), { live: false, reason: 'no_facts' });
  LIVE._REG.clear();
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'on' }, tenantId: 'never-loaded' }), false, 'profile not loaded = not live');
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'on' }, tenantId: null }), false);
  LIVE.attach({ id: 'T-ERR' }, null, { env: { BRAIN_KB_GATE: 'on' } });
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'on' }, tenantId: 'T-ERR' }), false, 'KB load error = not live');
});

test('kill switch per business: brain_target v1 holds the old brain even when ready; gate off beats ready', () => {
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2, brain_target: 'v1' }, { gate: 'on' }), { live: false, reason: 'held_v1' });
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2, brain_target: 'v1' }, { gate: 'off' }), { live: false, reason: 'gate_off' });
  LIVE._REG.clear();
  LIVE.attach({ id: 'T-HOLD' }, { version: 2, readyVersion: 2, brainTarget: 'v1', doc: null }, { env: { BRAIN_KB_GATE: 'on' } });
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'on' }, tenantId: 'T-HOLD' }), false);
});

test('no behaviour change: new selector == pre-contract selector over every facts x gate combination', () => {
  let n = 0;
  for (const t of [...FACTS, null]) {
    const k = loadShape(t);
    assert.equal(LIVE.isReady(k || {}), k ? oldIsReady(k) : oldIsReady({}), `isReady ${JSON.stringify(t)}`);
    const reg = new Map();
    reg.set('t1', { ready: !!(k && oldIsReady(k)) });
    for (const g of GATES) {
      const env = g === undefined ? {} : { BRAIN_KB_GATE: g };
      LIVE._REG.clear();
      LIVE.attach({ id: 'T1' }, k, { env });
      assert.equal(LIVE.decision({ env, tenantId: 'T1' }), oldDecision(env, 'T1', reg), `decision ${JSON.stringify(t)} gate=${g}`);
      assert.equal(LIVE.decision({ env, tenantId: null }), oldDecision(env, null, reg));
      assert.equal(LIVE.gateOn(env), oldGateOn(env));
      n++;
    }
  }
  assert.ok(n > 900);
});

test('no behaviour change on staging tenants (fixture of every staging tenant, 28 Oct)', () => {
  for (const t of STAGING) {
    const k = loadShape(t);
    for (const g of ['on', 'off', undefined]) {
      const env = g === undefined ? {} : { BRAIN_KB_GATE: g };
      LIVE._REG.clear();
      LIVE.attach({ id: t.id8 }, k, { env });
      const reg = new Map([[t.id8, { ready: oldIsReady(k) }]]);
      assert.equal(LIVE.decision({ env, tenantId: t.id8 }), oldDecision(env, t.id8, reg), `${t.id8} gate=${g}`);
    }
    assert.equal(isKbLive(t, { gate: 'on' }).reason, t.expect, t.id8);
    // kb-cutover's old on_v2 expression agrees with the predicate (gate aside)
    const oldOnV2 = t.brain_target !== 'v1' && t.kb_live_version != null && t.kb_live_version === t.kb_ready_version;
    assert.equal(isKbLive(t, { gate: true }).live, oldOnV2, t.id8);
  }
  assert.deepEqual(STAGING.filter((t) => isKbLive(t, { gate: 'on' }).live).map((t) => t.id8), ['b123e978', 'df4ad9d8']);
});

test('attach still only attaches the snapshot when the shared predicate says live', () => {
  const doc = { items: [], off: [], categories: [], index: null, counts: { services: 0, products: 0 } };
  for (const [k, env, want] of [
    [{ version: 2, readyVersion: 2, brainTarget: 'v2', doc }, { BRAIN_KB_GATE: 'on' }, true],
    [{ version: 2, readyVersion: 2, brainTarget: 'v2', doc }, { BRAIN_KB_GATE: 'off' }, false],
    [{ version: 2, readyVersion: 1, brainTarget: 'v2', doc }, { BRAIN_KB_GATE: 'on' }, false],
    [{ version: 2, readyVersion: 2, brainTarget: 'v1', doc }, { BRAIN_KB_GATE: 'on' }, false],
  ]) {
    const p = LIVE.attach({ id: 'T-A' + Math.random() }, k, { env });
    assert.equal(!!p.kb, want && isKbLive(k, { gate: env.BRAIN_KB_GATE }).live, JSON.stringify(k));
  }
});

test('contract surface: pure module, facts helper, columns, Desk closure ships it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/knowledge/kb/kbLive.js'), 'utf8');
  assert.doesNotMatch(src, /require\(/, 'no requires: safe for the Desk voice closure');
  assert.doesNotMatch(src, /process\.env/, 'gate is passed in, never read from env');
  assert.equal(KB_LIVE_COLUMNS, 'kb_live_version, kb_ready_version, brain_target');
  assert.deepEqual(kbLiveFacts({ kb_live_version: 2, kb_ready_version: null }), { liveVersion: 2, readyVersion: null, brainTarget: 'v2' });
  assert.equal(kbGateOn(true), true); assert.equal(kbGateOn('off'), false); assert.equal(kbGateOn(undefined), false);
  const { voiceClosure } = require('../dashboard/scripts/voice-modules.cjs');
  const r = voiceClosure(path.join(__dirname, '..'));
  assert.ok(r.files.includes('src/knowledge/kb/kbLive.js'));
  assert.deepEqual(r.missing, []);
  const ts = fs.readFileSync(path.join(__dirname, '../dashboard/src/lib/kbLive.server.ts'), 'utf8');
  assert.match(ts, /requireVoice<KbLiveModule>\("\.\/src\/knowledge\/kb\/kbLive\.js"\)/, 'Desk calls the same module, no twin');
  assert.match(ts, /process\.env\.BRAIN_KB_GATE/);
});
