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

test('P2: no gate: every business live whatever BRAIN_KB_GATE says; snapshot always attached', () => {
  for (const g of [undefined, null, '', 'off', '0', 'false', 'maybe', false]) {
    assert.deepEqual(isKbLive({ kb_live_version: 2, kb_ready_version: 2 }, { gate: g }), { live: true, reason: 'ready' });
  }
  assert.equal(LIVE.decision({ env: {}, tenantId: 'T' }), true);
  assert.equal(LIVE.decision({ env: { BRAIN_KB_GATE: 'off' }, tenantId: 'T' }), true);
  assert.equal(LIVE.decision({ env: {}, tenantId: '' }), false);
  const p = LIVE.attach({ id: 'T-OFF' }, { version: 2, readyVersion: 2, doc }, { env: {} });
  assert.ok(p.kb && p.kb.handle);
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
  // snapshot did not load (none published / DB error / exception): an EMPTY snapshot, never the old brain; logged
  const warn = console.warn; const logs = []; console.warn = (m) => logs.push(String(m));
  try {
    for (const [id, k] of [['T-NODOC', { version: 2, readyVersion: null, doc: null, loadError: 'snapshot_missing' }], ['T-NULL', null], ['T-EXC', { version: null, doc: null, loadError: 'exception' }]]) {
      const p = LIVE.attach({ id, servicesOffered: 'legacy text' }, k, { env: ON });
      assert.ok(p.kb && p.kb.handle, id);
      assert.equal(p.kb.loadError, true); assert.equal(p.kb.items, 0); assert.equal(p.kb.complete, false);
      assert.equal(p.kb.handle.doc.complete, false);
      assert.equal(p.servicesOffered, null, 'old fields not read');
      assert.equal(LIVE.decision({ env: ON, tenantId: id }), true);
    }
  } finally { console.warn = warn; }
  assert.equal(logs.filter((l) => /snapshot not loaded tenant=T-(NODOC|NULL|EXC) .*-> empty snapshot/.test(l)).length, 3, logs.join('\n'));
  assert.ok(logs.some((l) => /error=snapshot_missing/.test(l)));
  // P2: no gate: even with BRAIN_KB_GATE unset a failed load is the empty snapshot
  const w2 = console.warn; console.warn = () => {};
  try { assert.equal(LIVE.attach({ id: 'T-OFF2' }, null, { env: {} }).kb.loadError, true); } finally { console.warn = w2; }
});

test('brainMode: default full; tenants.brain_mode safe; BRAIN_SAFE_MODE=all overrides every business', () => {
  assert.deepEqual(brainMode(null), { mode: 'full', reason: 'no_tenant' });
  assert.deepEqual(brainMode({ kb_live_version: 2 }), { mode: 'full', reason: 'default' }, 'no column (before .4) = full');
  assert.deepEqual(brainMode({ brain_mode: 'full' }, { safeEnv: undefined }), { mode: 'full', reason: 'default' });
  assert.deepEqual(brainMode({ brain_mode: 'safe' }), { mode: 'safe', reason: 'admin' }, 'no recorded source = admin');
  assert.deepEqual(brainMode({ brain_mode: 'safe', brain_mode_source: 'owner' }), { mode: 'safe', reason: 'owner' });
  assert.deepEqual(brainMode({ brain_mode: 'safe', brain_mode_source: 'admin' }), { mode: 'safe', reason: 'admin' });
  assert.deepEqual(brainMode({ brain_mode: 'full', brain_mode_source: 'owner' }), { mode: 'full', reason: 'default' });
  assert.deepEqual(brainMode({ brain_mode: 'safe', brain_mode_source: 'owner' }, { safeEnv: 'all' }), { mode: 'safe', reason: 'env' }, 'env wins');
  assert.deepEqual(brainMode({ brainMode: 'SAFE', brainModeSource: 'owner' }), { mode: 'safe', reason: 'owner' });
  assert.deepEqual(brainMode({ brain_mode: 'weird' }), { mode: 'full', reason: 'default' });
  for (const v of ['all', 'ALL', ' all ']) assert.deepEqual(brainMode({ brain_mode: 'full' }, { safeEnv: v }), { mode: 'safe', reason: 'env' });
  for (const v of ['off', '', undefined, 'yes', '1', 'on']) assert.equal(brainMode({ brain_mode: 'full' }, { safeEnv: v }).mode, 'full', String(v));
  assert.equal(brainMode({ brain_mode: 'safe' }, { safeEnv: 'off' }).mode, 'safe');
  assert.equal(safeEnvState(undefined), 'off'); assert.equal(safeEnvState('off'), 'off'); assert.equal(safeEnvState('all'), 'all'); assert.equal(safeEnvState('yes'), 'invalid');
});

test('attach pins the decision on profile.brainModeDecision; profile.brainMode stays the tenants string (B1 adapter)', () => {
  const BM = require('../src/conversation/v2/brainModeAdapter');
  assert.equal(BM.usingPlatform(), true, 'B1 adapter loads src/knowledge/kb/brainMode.js');
  const m1 = LIVE.attach({ id: 'M1', brainMode: 'full' }, { version: 2, readyVersion: 2, doc }, { env: ON });
  assert.deepEqual(m1.brainModeDecision, { mode: 'full', reason: 'default' }); assert.equal(m1.brainMode, 'full');
  const m2 = LIVE.attach({ id: 'M2', brainMode: 'safe', brainModeSource: 'owner' }, { version: 2, readyVersion: 2, doc }, { env: ON });
  assert.deepEqual(m2.brainModeDecision, { mode: 'safe', reason: 'owner' });
  assert.deepEqual(BM.brainMode(m2, {}), { mode: 'safe', reason: 'owner' }, 'the adapter reads the same profile');
  const m2b = LIVE.attach({ id: 'M2b' }, { version: 2, readyVersion: 2, brainMode: 'safe', brainModeSource: 'admin', doc }, { env: ON });
  assert.equal(m2b.brainMode, 'safe'); assert.deepEqual(m2b.brainModeDecision, { mode: 'safe', reason: 'admin' }, 'filled from the KB load when the profile had none');
  assert.deepEqual(LIVE.attach({ id: 'M3' }, { version: 2, readyVersion: 2, doc }, { env: { ...ON, BRAIN_SAFE_MODE: 'all' } }).brainModeDecision, { mode: 'safe', reason: 'env' });
  assert.deepEqual(LIVE.attach({ id: 'M4' }, null, { env: { BRAIN_SAFE_MODE: 'all' } }).brainModeDecision, { mode: 'safe', reason: 'env' }, 'brake works with the gate off / no KB too');
});

test('db.getTenantById selects brain_mode + brain_mode_source (falls back without them); profile carries them', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
  assert.match(src, /withBrainMode \? ', brain_mode, brain_mode_source' : ''/);
  assert.match(src, /if \(error && \/brain_mode\/i\.test\(error\.message \|\| ''\)\) \{\n    withBrainMode = false;/);
  const { tenantProfileFromRow } = require('../src/tenantProfile');
  const p = tenantProfileFromRow({ id: 'x', business_name: 'X', brain_mode: 'safe', brain_mode_source: 'owner' }, { areaPicksRows: [] });
  assert.deepEqual(K.brainMode(p, {}), { mode: 'safe', reason: 'owner' });
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
  // P2: no switch left: BRAIN_KB_GATE off and no env list still keeps every business on the KB brain
  const off = { ...STAGING_FLAGS, BRAIN_KB_GATE: 'off', BRAIN_V2_TENANTS: '' };
  assert.equal(flag.brainV2Enabled({ env: off, tenantId: '78386574-aeb0-4b34-9296-00c5424cdd0e' }), true);
});

test('contract surface: pure module, facts helper, columns, Desk closure ships it', () => {
  const r0 = () => require('../dashboard/scripts/voice-modules.cjs').voiceClosure(path.join(__dirname, '..'));
  const src = fs.readFileSync(path.join(__dirname, '../src/knowledge/kb/kbLive.js'), 'utf8');
  assert.deepEqual(src.match(/require\([^)]*\)/g), ["require('./brainMode')"], 'only the pure ./brainMode: safe for the Desk voice closure');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/knowledge/kb/brainMode.js'), 'utf8'), /require\(|process\.env/);
  assert.ok(r0().files.includes('src/knowledge/kb/brainMode.js'), 'Desk closure ships brainMode.js');
  assert.doesNotMatch(src, /process\.env/, 'gate and safe mode are passed in, never read from env');
  assert.equal(KB_LIVE_COLUMNS, 'kb_live_version, kb_ready_version, brain_mode, brain_mode_source, kb_catalogue_complete_at');
  assert.deepEqual(kbLiveFacts({ kb_live_version: 2, kb_ready_version: null }), { liveVersion: 2, readyVersion: null, brainMode: 'full', brainModeSource: null });
  assert.equal(kbGateOn(true), true); assert.equal(kbGateOn('off'), false); assert.equal(kbGateOn(undefined), false);
  const { voiceClosure } = require('../dashboard/scripts/voice-modules.cjs');
  const r = voiceClosure(path.join(__dirname, '..'));
  assert.ok(r.files.includes('src/knowledge/kb/kbLive.js'));
  assert.deepEqual(r.missing, []);
  const ts = fs.readFileSync(path.join(__dirname, '../dashboard/src/lib/kbLive.server.ts'), 'utf8');
  assert.match(ts, /requireVoice<KbLiveModule>\("\.\/src\/knowledge\/kb\/kbLive\.js"\)/, 'Desk calls the same module, no twin');
  assert.match(ts, /sb\.rpc\("set_brain_mode", \{ p_tenant: tenantId, p_mode: mode \}\)/, 'owner toggle uses the session client + RPC');
  assert.doesNotMatch(ts, /process\.env\.BRAIN_KB_GATE/, 'P2: Desk reads no gate'); assert.match(ts, /process\.env\.BRAIN_SAFE_MODE/);
  const sql = fs.readFileSync(path.join(__dirname, '../docs/supabase/kb_v2_brain_mode.sql'), 'utf8');
  assert.match(sql, /2026-10-28\.4/); assert.match(sql, /brain_mode in \('full', 'safe'\)/); assert.doesNotMatch(sql, /drop column/i, 'P1 SQL is additive');
});

test('catalogue-complete mark: compile stamps doc.complete / complete_at; set or clear changes the source hash', () => {
  const C = require('../src/knowledge/kb/compile');
  const items = [{ id: 'a', kind: 'service', status: 'active', name_en: 'Deep clean', price_mode: 'fixed', price_amount: 6000, aliases: [], sort: 0 }];
  const none = C.compileKb({ items, categories: [] });
  assert.equal(none.doc.complete, false); assert.equal(none.doc.complete_at, null);
  const at = '2026-10-28T12:00:00.000Z';
  const marked = C.compileKb({ items, categories: [], completeAt: at });
  assert.equal(marked.doc.complete, true); assert.equal(marked.doc.complete_at, at);
  assert.equal(C.sourceHash({ items, categories: [] }), C.sourceHash({ items, categories: [], completeAt: null }), 'no mark = the same hash as before (no republish storm)');
  assert.notEqual(C.sourceHash({ items, categories: [], completeAt: at }), C.sourceHash({ items, categories: [] }), 'set -> new hash -> publish');
  assert.equal(LIVE.emptyDoc().complete, false);
  const B1 = require('../src/conversation/v2/degrade');
  if (typeof B1.catalogueState === 'function') {
    const p = LIVE.attach({ id: 'CMP-1' }, { version: 1, readyVersion: 1, doc: marked.doc }, { env: ON });
    assert.notEqual(B1.catalogueState(p), 'complete', 'B1 still needs >= 5 items');
  }
  const db = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
  assert.match(db, /select\('kb_catalogue_complete_at'\)/, 'listKbSource carries the mark into the compile source (and readiness hash)');
});

test('/healthz counts: safe mode by env / owner / admin and empty or missing snapshots, numbers only', () => {
  const rows = [
    { id: 'a', kb_live_version: 1, brain_mode: 'safe', brain_mode_source: 'owner' },
    { id: 'b', kb_live_version: 2, brain_mode: 'safe', brain_mode_source: 'admin' },
    { id: 'c', kb_live_version: 3, brain_mode: 'safe' },
    { id: 'd', kb_live_version: null, brain_mode: 'full' },
    { id: 'e', kb_live_version: 5 },
    { id: 'f', kb_live_version: 1, brain_mode: 'full' },
  ];
  const counts = new Map([['a:1', 12], ['b:2', 0], ['c:3', 4], ['f:1', 0]]);
  const t = LIVE.healthTally(rows, counts, {});
  assert.deepEqual(t, { tenants: 6, safe_mode: { total: 3, env: 0, owner: 1, admin: 2 }, snapshot_missing: 2, snapshot_empty: 2, empty_or_missing: 4 });
  assert.deepEqual(LIVE.healthTally(rows, counts, { safeEnv: 'all' }).safe_mode, { total: 6, env: 6, owner: 0, admin: 0 });
  assert.doesNotMatch(JSON.stringify(t), /"a"|"b"|"c"/, 'no tenant ids');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /counts: db\.kbHealthCountsCached\(\)/);
});

test('P2 SQL .5 drops brain_target; the down file restores it as v2 with its check', () => {
  const up = fs.readFileSync(path.join(__dirname, '../docs/supabase/kb_v2_drop_brain_target.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '../docs/supabase/kb_v2_drop_brain_target_down.sql'), 'utf8');
  assert.match(up, /2026-10-28\.5/); assert.match(up, /drop column if exists brain_target/);
  assert.match(down, /add column if not exists brain_target text not null default 'v2'/); assert.match(down, /brain_target in \('v1', 'v2'\)/);
  for (const f of ['src/db.js', 'src/knowledge/kb/live.js', 'src/knowledge/kb/kbLive.js', 'scripts/kb-cutover.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /brain_target|brainTarget|BRAIN_KB_GATE/, `${f} reads no brain_target / gate`);
  }
});
