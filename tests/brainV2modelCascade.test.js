'use strict';

// C7 model cascade (BRAIN_V2_MODEL): primary gemini-3.6-flash → backup gemini-3.5-flash-lite
// on timeout or hard fail, inside one overall HARD_CAP. No network; stand-ins only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MS = require('../src/conversation/v2/modelShadow');
const { createBrainV2Live, resolveModelShadow } = require('../src/conversation/v2/liveTurn');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;

const profile = {
  id: 'tenant-c7-cascade',
  businessName: 'Jirani Cleaning Services',
  agentName: 'Wanjiru',
  servicesCatalog: [
    { name: 'Sofa cleaning', price_range: 'From KSh 2,500' },
    { name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500' },
  ],
};
const BASE = { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function standIn(script, { delayMs = 5, name = 'stand-in' } = {}) {
  const seen = [];
  let i = 0;
  const fn = async ({ request, signal } = {}) => {
    seen.push({ request, signal });
    const out = typeof script === 'function' ? script(request, i) : script[i];
    i += 1;
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        if (signal) {
          if (signal.aborted) { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'TIMEOUT' })); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'TIMEOUT' })); }, { once: true });
        }
      });
    }
    return out || { calls: [] };
  };
  fn.seen = seen;
  fn.label = name;
  return fn;
}
function liveWith(env, extra = {}) {
  const writes = []; const stages = [];
  const live = createBrainV2Live({
    env: { ...BASE, ...env },
    applyTools: async (p) => { writes.push(p); return { results: [] }; },
    onModelStage: (s) => stages.push(s),
    traceTurnIndex: () => stages.length,
    log: () => {},
    ...extra,
  });
  return { live, writes, stages };
}
const call = (name, args = {}) => ({
  calls: [{ name, args }],
  usage: { promptTokenCount: 2400, candidatesTokenCount: 18, cachedContentTokenCount: 0 },
});

// ---------- A1 primary wins ----------
test('A1 primary wins under cap → gemini-3.6-flash, no backup call', async () => {
  const primary = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 20, name: 'primary' });
  const backup = standIn([call('lookup_file', { topic: 'last_visit' })], { delayMs: 20, name: 'backup' });
  const { live, stages } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  await live.run({ text: 'how much is sofa cleaning?', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  assert.equal(st.timedOut, false);
  assert.equal(st.cascade, false);
  assert.equal(st.answeredBy, 'primary');
  assert.equal(st.model, MS.MODEL_ID);
  assert.equal(st.model, 'gemini-3.6-flash');
  assert.equal(st.proposal.valid, true);
  assert.equal(st.proposal.tool, 'get_price');
  assert.equal(primary.seen.length, 1);
  assert.equal(backup.seen.length, 0);
  assert.equal(stages.length, 1);
});

// ---------- A2 timeout → backup ----------
test('A2 primary timeout → one backup flash-lite inside overall HARD_CAP', async () => {
  const primary = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 2000, name: 'primary' });
  const backup = standIn([call('lookup_file', { topic: 'last_visit' })], { delayMs: 30, name: 'backup' });
  const { live } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  const t0 = Date.now();
  await live.run({ text: 'what was my last visit?', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  const wall = Date.now() - t0;
  assert.equal(st.cascade, true);
  assert.equal(st.answeredBy, 'backup');
  assert.equal(st.model, MS.MODEL_BACKUP_ID);
  assert.equal(st.model, 'gemini-3.5-flash-lite');
  assert.equal(st.primaryTimedOut, true);
  assert.equal(st.timedOut, false);
  assert.equal(st.proposal.tool, 'lookup_file');
  assert.equal(primary.seen.length, 1);
  assert.equal(backup.seen.length, 1);
  assert.ok(st.latencyMs <= MS.HARD_CAP_MS + 120, `cascade wall ${st.latencyMs}`);
  assert.ok(wall < MS.HARD_CAP_MS + 400, `caller-adjacent wall ${wall}`);
  // primary must have been aborted (signal fired) before backup
  assert.equal(primary.seen[0].signal.aborted, true);
});

// ---------- A3 hard fail → backup ----------
test('A3 primary hard fail → one backup', async () => {
  const primary = async () => { throw Object.assign(new Error('boom'), { code: 'http_503' }); };
  primary.seen = [];
  const backup = standIn([call('get_hours', { day: 'today' })], { delayMs: 15, name: 'backup' });
  const { live } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  await live.run({ text: 'what time do you open?', profile, langLock: 'en' });
  const st = await live.lastModelShadow();
  assert.equal(st.cascade, true);
  assert.equal(st.answeredBy, 'backup');
  assert.equal(st.model, 'gemini-3.5-flash-lite');
  assert.equal(st.primaryError, 'http_503');
  assert.equal(st.primaryTimedOut, false);
  assert.equal(st.timedOut, false);
  assert.equal(st.proposal.tool, 'get_hours');
  assert.equal(backup.seen.length, 1);
});

// ---------- A4 both fail ----------
test('A4 both timeout → timedOut after cascade, proposal null, no throw', async () => {
  const primary = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 2000, name: 'primary' });
  const backup = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 2000, name: 'backup' });
  const { live, writes } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  const out = await live.run({ text: 'how much is sofa cleaning?', profile, langLock: 'en' });
  assert.ok(out.line, 'rules mouth still stands');
  const st = await live.lastModelShadow();
  assert.equal(st.cascade, true);
  // C1 honesty: both timeout → none (never claim backup success with null proposal)
  assert.equal(st.answeredBy, 'none');
  assert.equal(st.timedOut, true);
  assert.equal(st.proposal, null);
  assert.equal(writes.length, 0);
  assert.ok(st.latencyMs <= MS.HARD_CAP_MS + 120, String(st.latencyMs));
  assert.equal(primary.seen.length, 1);
  assert.equal(backup.seen.length, 1);
});

// ---------- A5 off / shadow default ----------
test('A5 off unchanged; shadow without backup keeps single-cap timeout', async () => {
  assert.equal(MS.modelMode({}), 'off');
  assert.equal(resolveModelShadow({ shadowModel: async () => ({}) }, {}), null);
  const slow = standIn([call('propose_booking', { service_id: 'svc_0' })], { delayMs: MS.HARD_CAP_MS + 400 });
  const { live } = liveWith({ BRAIN_V2_MODEL: 'shadow' }, { shadowModel: slow });
  const out = await live.run({ text: 'I want to book sofa cleaning', profile, langLock: 'en' });
  assert.ok(out.line);
  const st = await live.lastModelShadow();
  assert.equal(st.timedOut, true);
  assert.equal(st.cascade, false);
  assert.equal(st.answeredBy, 'primary');
  assert.equal(st.proposal, null);
});

// ---------- A6 model text mute ----------
test('A6 cascade plaintext is dropped — never spoken', async () => {
  const primary = standIn([{ calls: [], text: 'Hello Alvin, your sofa is ready', usage: { promptTokenCount: 10, candidatesTokenCount: 8 } }], { delayMs: 10 });
  const backup = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 10 });
  // primary succeeds with plaintext only — no cascade; text must be dropped in capped
  const r = await MS.cappedCascade({
    primary, backup, request: {}, primaryId: MS.MODEL_ID, backupId: MS.MODEL_BACKUP_ID,
  });
  assert.equal(r.answeredBy, 'primary');
  assert.equal(r.text, '[model text dropped]');
  assert.equal(backup.seen.length, 0);
  const { live } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  const out = await live.run({ text: 'hi', profile, langLock: 'en' });
  assert.doesNotMatch(out.line || '', /sofa is ready|Hello Alvin/i);
});

// ---------- A7 env override ----------
test('A7 env overrides; blank falls back to Alvin GO defaults', () => {
  assert.deepEqual(MS.resolveModelIds({}), { primary: 'gemini-3.6-flash', backup: 'gemini-3.5-flash-lite' });
  assert.deepEqual(MS.resolveModelIds({ BRAIN_V2_MODEL_ID: '  ', BRAIN_V2_MODEL_BACKUP_ID: '' }), {
    primary: 'gemini-3.6-flash', backup: 'gemini-3.5-flash-lite',
  });
  assert.deepEqual(MS.resolveModelIds({
    BRAIN_V2_MODEL_ID: 'gemini-custom-primary',
    BRAIN_V2_MODEL_BACKUP_ID: 'gemini-custom-backup',
  }), { primary: 'gemini-custom-primary', backup: 'gemini-custom-backup' });
  assert.equal(MS.MODEL_ID, 'gemini-3.6-flash');
  assert.equal(MS.MODEL_BACKUP_ID, 'gemini-3.5-flash-lite');
});

// ---------- B1 HD_c170-shaped ----------
test('B1 HD_c1708336-shaped slow primary + fast backup → proposal present via cascade', async () => {
  // Shape: every turn primary would die at cap; backup returns lookup_file (the seed mouth needs).
  // Use shadow so only the logged cascade path runs (on also consults via cappedCascade).
  const primary = standIn(() => call('get_price', { service_id: 'svc_0' }), { delayMs: 2000, name: 'primary' });
  const backup = standIn(() => call('lookup_file', { topic: 'last_visit' }), { delayMs: 25, name: 'backup' });
  const { live, stages } = liveWith(
    { BRAIN_V2_MODEL: 'shadow' },
    { shadowModel: primary, shadowBackupModel: backup },
  );
  for (const text of ['Nilikuwa nataka kujua services', 'Nieleze kuhusu sofa']) {
    await live.run({ text, profile, langLock: 'en' });
    await live.lastModelShadow();
  }
  assert.equal(stages.length, 2);
  for (const st of stages) {
    assert.equal(st.cascade, true, JSON.stringify(st));
    assert.equal(st.answeredBy, 'backup');
    assert.ok(st.proposal, 'backup proposal present — not null-without-backup');
    assert.equal(st.proposal.tool, 'lookup_file');
    assert.equal(st.timedOut, false);
    assert.ok(st.latencyMs <= MS.HARD_CAP_MS + 120, String(st.latencyMs));
  }
  assert.equal(backup.seen.length, 2);
  assert.equal(primary.seen.length, 2);
  assert.equal(MS.scoreCascadeStages(stages).pass, true);
});

// ---------- B2 score helper ----------
test('B2 score fails 100% primary-only timeouts with cascade enabled and zero backup attempts', () => {
  const bad = [
    { stage: 'brain_v2_model', timedOut: true, cascade: false, answeredBy: 'primary', model: 'gemini-3.6-flash' },
    { stage: 'brain_v2_model', timedOut: true, cascade: false, answeredBy: 'primary', model: 'gemini-3.6-flash' },
  ];
  const fail = MS.scoreCascadeStages(bad);
  assert.equal(fail.pass, false);
  assert.equal(fail.reason, 'primary_only_timeouts_no_backup');
  assert.equal(fail.backupAttempts, 0);

  const good = [
    { stage: 'brain_v2_model', timedOut: false, cascade: true, answeredBy: 'backup', model: 'gemini-3.5-flash-lite' },
    { stage: 'brain_v2_model', timedOut: true, cascade: true, answeredBy: 'backup', model: 'gemini-3.5-flash-lite' },
  ];
  const ok = MS.scoreCascadeStages(good);
  assert.equal(ok.pass, true);
  assert.equal(ok.backupAttempts, 2);

  // mixed: at least one backup attempt → pass
  const mixed = [
    { stage: 'brain_v2_model', timedOut: true, cascade: false, answeredBy: 'primary' },
    { stage: 'brain_v2_model', timedOut: false, cascade: true, answeredBy: 'backup' },
  ];
  assert.equal(MS.scoreCascadeStages(mixed).pass, true);
});

test('cappedCascade overall wall stays ≤ HARD_CAP (smooth, not 900+900)', async () => {
  const primary = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 2000 });
  const backup = standIn([call('get_hours', { day: 'today' })], { delayMs: 40 });
  const t0 = Date.now();
  const r = await MS.cappedCascade({
    primary, backup, request: {}, capMs: MS.HARD_CAP_MS,
    primaryId: 'gemini-3.6-flash', backupId: 'gemini-3.5-flash-lite',
  });
  const wall = Date.now() - t0;
  assert.equal(r.cascade, true);
  assert.equal(r.answeredBy, 'backup');
  assert.ok(wall <= MS.HARD_CAP_MS + 150, `wall ${wall}`);
  assert.ok(r.latencyMs <= MS.HARD_CAP_MS + 150, `latencyMs ${r.latencyMs}`);
  // C2: primary budget is nearly full wall (not 550 starve)
  assert.ok(r.primaryLatencyMs <= MS.HARD_CAP_MS - MS.MIN_BACKUP_MS + 80);
  assert.ok(MS.HARD_CAP_MS - MS.MIN_BACKUP_MS - MS.CASCADE_SLACK_MS > 550, 'primary not 550-starved');
});


// ---------- C1 honesty / C2 budget (mouth-seed stack) ----------
test('C1 both timeout → answeredBy none (not backup) with null proposal', async () => {
  const primary = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 5000, name: 'primary' });
  const backup = standIn([call('get_price', { service_id: 'svc_0' })], { delayMs: 5000, name: 'backup' });
  const r = await MS.cappedCascade({
    primary, backup, request: {}, capMs: MS.HARD_CAP_MS,
    primaryId: MS.MODEL_ID, backupId: MS.MODEL_BACKUP_ID,
  });
  assert.equal(r.cascade, true);
  assert.equal(r.answeredBy, 'none');
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.calls, []);
  assert.notEqual(r.answeredBy, 'backup');
});

test('C2 primary budget is not 550-starve; HARD_CAP evidence band ~1.5–2.0s', () => {
  assert.ok(MS.HARD_CAP_MS >= 1500 && MS.HARD_CAP_MS <= 2000, String(MS.HARD_CAP_MS));
  const primaryBudget = Math.max(MS.HARD_CAP_MS - MS.MIN_BACKUP_MS - MS.CASCADE_SLACK_MS, MS.MIN_BACKUP_MS);
  assert.ok(primaryBudget >= 1400, `primaryBudget ${primaryBudget} still starved (was ~550)`);
  assert.ok(primaryBudget > 550, 'must exceed old 550 starve');
  assert.ok(MS.BACKUP_RESERVE_MS <= MS.MIN_BACKUP_MS + 1);
});
