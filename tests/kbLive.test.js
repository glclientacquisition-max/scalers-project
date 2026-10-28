'use strict';
// Shared contract (src/knowledge/kb/kbLive.js), retire-the-old-brain step P1
// (briefs/retire-old-brain-plan-2026-10-28.md): with BRAIN_KB_GATE on the KB brain answers EVERY business; readiness is
// a quality reason only; brain_target 'v1' holds nothing; brainMode ('full' | 'safe') is the one per-call choice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../src/knowledge/kb/kbLive');
const { isKbLive, kbQuality, brainMode, kbGateOn, kbLiveFacts, safeEnvState, KB_LIVE_COLUMNS } = K;
const LIVE = require('../src/knowledge/kb/live');
const STAGING = require('./fixtures/kb/kbLiveStaging.json').tenants;

const ON = { BRAIN_KB_GATE: 'on' };
// staging Voice's brain flags today (Railway staging, 28 Oct): the owned v2 + engines stack
const STAGING_FLAGS = { BRAIN_KB_GATE: 'on', BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_ENGINES: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_V2_TENANTS: 'df4ad9d8-28ff-4810-b1e6-94f5495472b0' };
const doc = { items: [], off: [], categories: [], index: null, counts: { items: 0, services: 0, products: 0 } };

test('gate off = kill switch (until P2): gate_off, selector null, no snapshot attached', () => {
  for (const g of [undefined, null, '', 'off', '0', 'false', 'maybe', false]) {
    assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2 }, { gate: g }), { live: false, reason: 'gate_off' });
  }
  assert.equal(LIVE.decision({ env: {}, tenantId: 'T' }), null);
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'off' }, tenantId: 'T' }), null);
  const p = LIVE.attach({ id: 'T-OFF' }, { version: 2, readyVersion: 2, doc }, { env: {} });
  assert.equal(p.kb, undefined);
});

test('gate on + ready: live, reason ready', () => {
  for (const g of [true, 'on', 'ON', ' on ', '1', 'true', 'yes']) assert.deepEqual(isKbLive({ kb_live_version: 3, kb_ready_version: 3 }, { gate: g }), { live: true, reason: 'ready' });
  assert.deepEqual(isKbLive({ version: 3, readyVersion: 3 }, { gate: 'on' }), { live: true, reason: 'ready' });
});

test('gate on + NOT ready: still live (KB brain for every business), readiness is the reason only', () => {
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: null }, { gate: 'on' }), { live: true, reason: 'never_ready' });
  assert.deepEqual(isKbLive({ kb_live_version: 3, kb_ready_version: 2 }, { gate: 'on' }), { live: true, reason: 'ready_stale' });
  assert.deepEqual(isKbLive({ kb_live_version: null, kb_ready_version: null }, { gate: 'on' }), { live: true, reason: 'no_live_version' });
  assert.deepEqual(isKbLive(null, { gate: 'on' }), { live: true, reason: 'no_facts' });
  LIVE._REG.clear();
  assert.equal(LIVE.decision({ env: ON, tenantId: 'never-loaded' }), true, 'a business never seen on this replica still gets the KB brain');
  LIVE.attach({ id: 'T-ERR' }, null, { env: ON });
  assert.equal(LIVE.decision({ env: ON, tenantId: 'T-ERR' }), true, 'KB load error: KB brain, degraded (empty catalogue)');
  assert.equal(LIVE.quality('T-ERR'), 'no_facts');
  assert.equal(LIVE.decision({ env: ON, tenantId: null }), false, 'no business id = no brain to run');
  assert.equal(LIVE.decision({ env: ON, tenantId: '' }), false);
});

test('no v1 hold: brain_target v1 is ignored (held_v1 never returned)', () => {
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2, brain_target: 'v1' }, { gate: 'on' }), { live: true, reason: 'ready' });
  assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2, brainTarget: 'v1' }, { gate: 'on' }), { live: true, reason: 'ready' });
  LIVE._REG.clear();
  LIVE.attach({ id: 'T-HOLD' }, { version: 2, readyVersion: 2, brainTarget: 'v1', doc }, { env: ON });
  assert.equal(LIVE.decision({ env: ON, tenantId: 'T-HOLD' }), true);
});

test('attach: gate on attaches the live snapshot for ready AND unready businesses (empty snapshot too)', () => {
  for (const k of [
    { version: 2, readyVersion: 2, doc },
    { version: 2, readyVersion: null, doc },
    { version: 3, readyVersion: 2, doc },
  ]) {
    const p = LIVE.attach({ id: `T-A-${k.readyVersion}-${k.version}` }, k, { env: ON });
    assert.ok(p.kb && p.kb.handle, JSON.stringify(k));
    assert.equal(p.kbProjected, true);
    assert.equal(p.servicesOffered, null);
  }
  const p = LIVE.attach({ id: 'T-NODOC' }, { version: 2, readyVersion: null, doc: null }, { env: ON });
  assert.equal(p.kb, undefined, 'no document: nothing to attach (degrade)');
});

test('brainMode: default full; tenants.brain_mode safe; BRAIN_SAFE_MODE=all overrides every business', () => {
  assert.deepEqual(brainMode(null), { mode: 'full', reason: 'normal' });
  assert.deepEqual(brainMode({ kb_live_version: 2 }), { mode: 'full', reason: 'normal' }, 'no column (before .4) = full');
  assert.deepEqual(brainMode({ brain_mode: 'full' }, { safeEnv: undefined }), { mode: 'full', reason: 'normal' });
  assert.deepEqual(brainMode({ brain_mode: 'safe' }), { mode: 'safe', reason: 'tenant' });
  assert.deepEqual(brainMode({ brainMode: 'SAFE' }), { mode: 'safe', reason: 'tenant' });
  assert.deepEqual(brainMode({ brain_mode: 'weird' }), { mode: 'full', reason: 'normal' });
  for (const v of ['all', 'ALL', ' all ']) assert.deepEqual(brainMode({ brain_mode: 'full' }, { safeEnv: v }), { mode: 'safe', reason: 'global' });
  for (const v of ['off', '', undefined, 'yes', '1', 'on']) assert.equal(brainMode({ brain_mode: 'full' }, { safeEnv: v }).mode, 'full', String(v));
  assert.equal(brainMode({ brain_mode: 'safe' }, { safeEnv: 'off' }).mode, 'safe');
  assert.equal(safeEnvState(undefined), 'off'); assert.equal(safeEnvState('off'), 'off'); assert.equal(safeEnvState('all'), 'all'); assert.equal(safeEnvState('yes'), 'invalid');
});

test('attach pins profile.brainMode for the call (env BRAIN_SAFE_MODE passed in, tenant brain_mode from the load)', () => {
  assert.deepEqual(LIVE.attach({ id: 'M1' }, { version: 2, readyVersion: 2, brainMode: 'full', doc }, { env: ON }).brainMode, { mode: 'full', reason: 'normal' });
  assert.deepEqual(LIVE.attach({ id: 'M2' }, { version: 2, readyVersion: 2, brainMode: 'safe', doc }, { env: ON }).brainMode, { mode: 'safe', reason: 'tenant' });
  assert.deepEqual(LIVE.attach({ id: 'M3' }, { version: 2, readyVersion: 2, doc }, { env: { ...ON, BRAIN_SAFE_MODE: 'all' } }).brainMode, { mode: 'safe', reason: 'global' });
  assert.deepEqual(LIVE.attach({ id: 'M4' }, null, { env: { BRAIN_SAFE_MODE: 'all' } }).brainMode, { mode: 'safe', reason: 'global' }, 'brake works with the gate off / no KB too');
});

test('staging tenants (fixture, 28 Oct): every one on the KB brain; quality reason unchanged', () => {
  for (const t of STAGING) {
    assert.deepEqual(isKbLive(t, { gate: 'on' }), { live: true, reason: t.expect }, t.id8);
    assert.equal(kbQuality(t), t.expect);
  }
});

test('the 5 unready staging businesses no longer land on the old Gemini turn (server.js v2Live = brainV2Enabled && mode live)', () => {
  const flag = require('../src/conversation/v2/flag');
  const V1 = require('../src/conversation/v2/v1draft');
  for (const id of ['78386574-aeb0-4b34-9296-00c5424cdd0e', '42cad929-b402-42bc-89c4-7b6544dfbc4c', '60283fd8-57ba-49da-9a3b-c1b194e3ea80', '9301dbca-e424-4534-9e9a-f209936ebb3d', '995e30d9-5d89-4e38-9855-dc7d0aac781c']) {
    LIVE._REG.clear();
    LIVE.attach({ id }, { version: 2, readyVersion: null, doc }, { env: STAGING_FLAGS });
    assert.equal(flag.brainV2Enabled({ env: STAGING_FLAGS, tenantId: id }), true, id);
    assert.equal(flag.brainV2Mode({ env: STAGING_FLAGS }), 'live');
    assert.equal(flag.brainEnginesOn({ env: STAGING_FLAGS, tenantId: id }), true, `${id} engines`);
    assert.equal(V1.mode({ env: STAGING_FLAGS, tenantId: id }), 'on', `${id} v1draft (not in BRAIN_V1_DRAFT_TENANTS)`);
  }
  // kill switch still routes by the env lists until P2 (gate off): a business outside BRAIN_V2_TENANTS is not on v2
  const off = { ...STAGING_FLAGS, BRAIN_KB_GATE: 'off' };
  assert.equal(flag.brainV2Enabled({ env: off, tenantId: '78386574-aeb0-4b34-9296-00c5424cdd0e' }), false);
});

test('contract surface: pure module, facts helper, columns, Desk closure ships it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/knowledge/kb/kbLive.js'), 'utf8');
  assert.doesNotMatch(src, /require\(/, 'no requires: safe for the Desk voice closure');
  assert.doesNotMatch(src, /process\.env/, 'gate and safe mode are passed in, never read from env');
  assert.equal(KB_LIVE_COLUMNS, 'kb_live_version, kb_ready_version, brain_mode');
  assert.deepEqual(kbLiveFacts({ kb_live_version: 2, kb_ready_version: null }), { liveVersion: 2, readyVersion: null, brainMode: 'full' });
  assert.equal(kbGateOn(true), true); assert.equal(kbGateOn('off'), false); assert.equal(kbGateOn(undefined), false);
  const { voiceClosure } = require('../dashboard/scripts/voice-modules.cjs');
  const r = voiceClosure(path.join(__dirname, '..'));
  assert.ok(r.files.includes('src/knowledge/kb/kbLive.js'));
  assert.deepEqual(r.missing, []);
  const ts = fs.readFileSync(path.join(__dirname, '../dashboard/src/lib/kbLive.server.ts'), 'utf8');
  assert.match(ts, /requireVoice<KbLiveModule>\("\.\/src\/knowledge\/kb\/kbLive\.js"\)/, 'Desk calls the same module, no twin');
  assert.match(ts, /process\.env\.BRAIN_KB_GATE/); assert.match(ts, /process\.env\.BRAIN_SAFE_MODE/);
  const sql = fs.readFileSync(path.join(__dirname, '../docs/supabase/kb_v2_brain_mode.sql'), 'utf8');
  assert.match(sql, /2026-10-28\.4/); assert.match(sql, /brain_mode in \('full', 'safe'\)/); assert.doesNotMatch(sql, /drop column/i, 'P1 SQL is additive');
});
