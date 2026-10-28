'use strict';
// Compile on save for the v2 KB: (legacy sync) -> compile -> publish (live or failed) -> readiness.
// Never on the Desk save response path (Desk pings; this runs in the background, coalesced per business).
const { compileKb, sourceHash } = require('./compile');
const { fromLegacy } = require('./items');
const live = require('./live');
const { runReadiness } = require('./readiness');
const { suggestSwahili } = require('./swSuggest');

const nameKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Import today's services_catalog / product_catalog into kb_items, ADD-ONLY (Alvin, 28 Oct: kb_items is the source of truth).
 * Only rows new to the KB (id and name not already there) are inserted. An existing item is never changed, so the owner's
 * paused / not_offered / holdable / excludes stay as set, and nothing absent from the old columns is hidden.
 * Used by the one-time backfill (scripts/kb-backfill.js); saves of the old columns no longer sync (server.js).
 */
async function syncFromLegacy(db, tenantId, row) {
  const { items, categories } = fromLegacy(row);
  const src = await db.listKbSource(tenantId);
  const ids = new Set((src.items || []).map((x) => x.id));
  const names = new Set((src.items || []).map((x) => `${x.kind}:${nameKey(x.name_en)}`));
  const haveCats = new Set((src.categories || []).map((c) => c.id));
  const fresh = [];
  for (const it of items) {
    const nk = `${it.kind}:${nameKey(it.name_en)}`;
    if (ids.has(it.id) || names.has(nk)) continue;
    ids.add(it.id); names.add(nk);
    const o = { ...it }; if (!o.aliases || !o.aliases.length) delete o.aliases;
    fresh.push(o);
  }
  const cats = categories.filter((c) => !haveCats.has(c.id) && fresh.some((i) => i.category_id === c.id));
  const r = fresh.length || cats.length ? await db.upsertKbItems(tenantId, { items: fresh, categories: cats }) : null;
  return { services: fresh.filter((x) => x.kind === 'service').length, products: fresh.filter((x) => x.kind === 'product').length, kept: items.length - fresh.length, upserted: r?.upserted || 0, hidden: 0 };
}

/**
 * @param {object} db  src/db.js surface (listKbSource, upsertKbItems, publishKbSnapshot, getKbState, recordKbReadiness, getTenantProfile)
 * @param {string} tenantId
 * @param {{ legacyRow?: object|null, generate?: Function|null, force?: boolean, by?: string, log?: Function }} o
 */
async function compileAndPublish(db, tenantId, { legacyRow = null, generate = null, force = false, by = 'compile', log = () => {} } = {}) {
  const t0 = Date.now();
  const out = { tenantId, synced: null, skipped: false, version: null, status: null, issues: [], readiness: null };
  if (legacyRow) out.synced = await syncFromLegacy(db, tenantId, legacyRow);
  let src = await db.listKbSource(tenantId);
  // Swahili names: AI suggests (state 'suggested'), the owner approves; never spoken before that
  if (generate) {
    try {
      const sug = await suggestSwahili(src.items, generate);
      if (sug.length) { await db.upsertKbItems(tenantId, { items: sug }); src = await db.listKbSource(tenantId); }
      out.swSuggested = sug.length;
    } catch (e) { out.swSuggestError = String(e && (e.code || e.message) || e); }
  }
  const state = await db.getKbState(tenantId);
  const hash = sourceHash(src);
  if (!force && state.latest && state.latest.source_hash === hash && state.latest.status === 'live') {
    out.skipped = true; out.version = state.latest.version; out.status = 'unchanged';
  } else {
    const c = compileKb({ ...src, business: state.tenant?.business_name || null });
    out.issues = c.issues; out.status = c.status;
    out.version = await db.publishKbSnapshot(tenantId, { doc: c.doc, sourceHash: c.sourceHash, issues: c.issues, status: c.status, compiler: 'rules' });
    log(`[kb] compile tenant=${tenantId} v=${out.version} status=${c.status} items=${c.doc.counts.items} issues=${c.issues.length} bytes=${c.bytes} ms=${Date.now() - t0}`);
  }
  out.readiness = await checkReadiness(db, tenantId, { by, currentHash: hash });
  out.ms = Date.now() - t0;
  return out;
}

/** Re-run readiness on the live snapshot and record it. */
function modelForTests(env = process.env) {
  const key = String(env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { createGeminiStreamModel } = require('../../conversation/v2/transport');
  const ids = require('../../conversation/v2/modelShadow').resolveModelIds(env);
  const models = {};
  return { streamFor: (id) => models[id] || (models[id] = createGeminiStreamModel({ apiKey: key, model: id })), modelId: ids.primary };
}
function extraTests(tenantId, env = process.env) {
  try { const m = JSON.parse(String(env.KB_TEXT_TESTS || '{}')); const v = m[String(tenantId).toLowerCase()] || m[tenantId]; return Array.isArray(v) ? v.slice(0, 8).map(String) : []; } catch { return []; }
}

async function checkReadiness(db, tenantId, { by = 'script', currentHash = null, model = null, env = process.env } = {}) {
  const state = await db.getKbState(tenantId);
  const liveV = state.tenant?.kb_live_version;
  const profile = await db.getTenantProfile({ tenantId });
  let latestLive = null;
  if (liveV != null) {
    const kbx = await db.loadKbLive(tenantId, { force: true });
    if (kbx && kbx.doc) live.attach(profile, kbx, { force: true });
    latestLive = state.latest && state.latest.version === liveV ? state.latest : { ...(state.latest || {}), version: liveV, status: 'live', source_hash: currentHash, issues: [] };
  }
  if (currentHash == null) currentHash = sourceHash(await db.listKbSource(tenantId));
  const r = runReadiness(profile, { latest: latestLive, currentHash });
  // the same questions through the live new brain, model included when this process has one (text mode, no writes)
  if (profile.kb && profile.kb.handle) {
    const { runTextTests } = require('./textTest');
    const m = model === false ? null : model || modelForTests(env);
    const tt = await runTextTests({ profile, streamFor: m ? m.streamFor : null, modelId: m ? m.modelId : null, env, extras: extraTests(tenantId, env) });
    for (const t of tt) r.tests.push({ name: `brain:${t.expect}`, ok: t.extra ? t.ok || t.problems.every((p) => p === 'sentences:4') : t.ok, asked: t.text, heard: t.line, why: t.problems.join(',') || null, ms: t.ms, lookup_ms: t.lookup_ms, kb_kind: t.kb_kind, model: t.model, path: t.path, extra: t.extra });
    r.passed = r.checks.every((c) => c.ok) && r.tests.every((t) => t.ok);
  }
  await db.recordKbReadiness(tenantId, { version: liveV ?? null, passed: r.passed, checks: r.checks, tests: r.tests, by });
  return { passed: r.passed, version: liveV ?? null, failing: r.checks.filter((c) => !c.ok).map((c) => c.id).concat(r.tests.filter((t) => !t.ok).map((t) => `test:${t.name}`)), checks: r.checks, tests: r.tests };
}

// one compile per business at a time; a save during a compile runs once more after it
const RUNNING = new Map();
function scheduleKbCompile(db, tenantId, opts = {}) {
  if (!tenantId) return { scheduled: false };
  const cur = RUNNING.get(tenantId);
  if (cur) { cur.again = opts; return { scheduled: true, coalesced: true }; }
  const entry = { again: null };
  RUNNING.set(tenantId, entry);
  const go = async (o) => {
    try { await compileAndPublish(db, tenantId, { ...o, log: (m) => console.log(m) }); } catch (e) { console.warn(`[kb] compile tenant=${tenantId} failed: ${e && e.message}`); }
    if (entry.again) { const n = entry.again; entry.again = null; return go(n); }
    RUNNING.delete(tenantId);
    return null;
  };
  setImmediate(() => { go(opts); });
  return { scheduled: true, coalesced: false };
}

/** Boot / nightly sweep: re-check every business with a live snapshot (results in kb_readiness). */
async function sweepReadiness(db, { by = 'boot', log = () => {} } = {}) {
  const ids = await db.listKbTenants();
  const out = [];
  for (const id of ids) {
    try { const r = await checkReadiness(db, id, { by }); out.push({ id, passed: r.passed, failing: r.failing }); log(`[kb] readiness tenant=${id} passed=${r.passed} failing=${r.failing.join('|') || '-'}`); } catch (e) { out.push({ id, error: String(e && e.message || e) }); }
  }
  return out;
}

module.exports = { compileAndPublish, checkReadiness, syncFromLegacy, scheduleKbCompile, sweepReadiness, modelForTests };
