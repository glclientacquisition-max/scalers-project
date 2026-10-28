'use strict';
// v2 KB on the live call: attach the live snapshot to the tenant profile (loaded once per call at
// /voice/incoming prefetch, pinned on the profile object for the whole call) and answer the brain's questions.
const R = require('./reader');
const { docToLegacy } = require('./items');
const { isKbLive, kbQuality, brainMode } = require('./kbLive');

/** P2: the KB brain answers every business; the gate env is gone. Always true (kept for old callers). */
// eslint-disable-next-line no-unused-vars
function gateOn(_env) { return true; }

// tenant -> { version, readyVersion, quality, brainMode, facts, at }: written when a profile loads.
const REG = new Map();
function note(tenantId, info) { if (tenantId) REG.set(String(tenantId).toLowerCase(), { ...info, at: Date.now() }); }
/** True for every business (false only with no business id). P2: never null, no env lists. */
function decision({ tenantId } = {}) {
  return isKbLive(null).live && tenantId != null && String(tenantId).trim() !== '';
}
/** Readiness / quality reason for a business seen on this replica (never a brain switch). */
function quality(tenantId) {
  const r = tenantId == null ? null : REG.get(String(tenantId).toLowerCase());
  return kbQuality(r ? r.facts : null);
}
/** The live snapshot passed readiness (quality signal only). */
const isReady = (k) => kbQuality(k) === 'ready';

let EMPTY = null;
/** The empty snapshot (no items, doc.complete false): what a call gets when its snapshot cannot be loaded. */
function emptyDoc() {
  if (!EMPTY) { EMPTY = require('./compile').compileKb({ items: [], categories: [], business: null }).doc; Object.freeze(EMPTY); }
  return EMPTY;
}

/**
 * Mutates and returns the profile. extras.kb = { version, readyVersion, brainMode, brainModeSource, doc, bytes, loadMs,
 * loadError } | null. Every business gets profile.kb (readiness does not gate it) and the legacy catalogue
 * fields projected from it. A snapshot that did not load (none published, DB error, missing row) is an EMPTY snapshot
 * (doc.complete false: Brain B1 treats the catalogue as empty), logged, never the old brain.
 * profile.brainMode / brainModeSource stay the tenants strings (B1's adapter reads them); the shared decision
 * { mode, reason } is pinned on profile.brainModeDecision.
 */
function attach(profile, kbExtras, { env = process.env, force = false } = {}) {
  if (!profile) return profile;
  const k = kbExtras || null;
  if (profile.brainMode == null && k && k.brainMode) profile.brainMode = String(k.brainMode);
  if (profile.brainModeSource == null && k && k.brainModeSource) profile.brainModeSource = String(k.brainModeSource);
  const facts = k ? { version: k.version ?? null, readyVersion: k.readyVersion ?? null, brainMode: profile.brainMode || 'full', brainModeSource: profile.brainModeSource || null } : null;
  const info = { ready: isReady(facts), version: facts?.version ?? null, readyVersion: facts?.readyVersion ?? null, quality: kbQuality(facts) };
  profile.brainModeDecision = brainMode({ brainMode: profile.brainMode, brainModeSource: profile.brainModeSource }, { safeEnv: env.BRAIN_SAFE_MODE });
  // P2: no gate. The readiness runner forces an attach to test a snapshot.
  if (force && (!k || !k.doc)) return profile;
  let doc = k && k.doc;
  let loadError = false;
  if (!doc) {
    doc = emptyDoc(); loadError = true;
    console.warn(`[kb] snapshot not loaded tenant=${profile.id} version=${facts?.version ?? 'none'}${k && k.loadError ? ` error=${k.loadError}` : ''} -> empty snapshot (doc.complete false)`);
  }
  if (!force) note(profile.id, { ...info, facts, brainMode: profile.brainModeDecision, empty: loadError || !(doc.items && doc.items.length) });
  const handle = R.cached(profile.id, loadError ? 'empty' : k.version, doc, loadError ? null : k.bytes);
  if (!handle) return profile;
  profile.kb = { ...info, handle, loadMs: k ? k.loadMs ?? null : null, items: doc.items.length, loadError, complete: doc.complete === true };
  const legacy = docToLegacy(doc);
  if (legacy) { profile.servicesCatalog = legacy.servicesCatalog; profile.productCatalog = legacy.productCatalog; profile.kbProjected = true; }
  // the old free-text services line (tenants.services_offered, now a derived copy) is not read on the KB path:
  // every caller-facing reader goes through kb/source.js (groups for the greeting, item descriptions for notes)
  profile.servicesOffered = null;
  return profile;
}
/**
 * /healthz counts, pure: tenants rows { id, kb_live_version, brain_mode?, brain_mode_source? } and a Map
 * `${tenant}:${version}` -> live snapshot item_count. Numbers only, never ids.
 */
function healthTally(rows, itemCounts, { safeEnv } = {}) {
  const safe = { env: 0, owner: 0, admin: 0 };
  let missing = 0; let empty = 0;
  for (const t of rows || []) {
    const m = brainMode(t, { safeEnv });
    if (m.mode === 'safe' && safe[m.reason] != null) safe[m.reason] += 1;
    const key = `${t.id}:${t.kb_live_version}`;
    if (t.kb_live_version == null || !itemCounts || !itemCounts.has(key)) missing += 1;
    else if (!Number(itemCounts.get(key))) empty += 1;
  }
  const n = (rows || []).length;
  return { tenants: n, safe_mode: { total: safe.env + safe.owner + safe.admin, ...safe }, snapshot_missing: missing, snapshot_empty: empty, empty_or_missing: missing + empty };
}
const handle = (profile) => (profile && profile.kb && profile.kb.handle) || null;

/** Numbers a model sentence may say about the catalogue: prices, variant prices, group spans, group counts. */
function knownNumbers(profile) {
  const h = handle(profile);
  const out = new Set();
  if (!h) return out;
  const add = (v) => { if (v == null || !Number.isFinite(Number(v))) return; const [w, c] = Number(v).toFixed(2).split('.'); out.add(String(Number(w))); if (c !== '00') { out.add(c); out.add(String(Number(c))); } };
  for (const it of h.doc.items) { for (const v of it.price.numbers || []) add(v); for (const va of it.variants || []) for (const v of va.price.numbers || []) add(v); }
  for (const c of h.categories) { add(c.count); for (const v of c.span.numbers || []) add(v); }
  return out;
}
/** Index for the prompt (names only, never prices: price only on pick). */
function promptIndex(profile) {
  const h = handle(profile);
  return h ? h.doc.index : null;
}

module.exports = { gateOn, decision, quality, note, attach, emptyDoc, healthTally, handle, knownNumbers, promptIndex, isReady, _REG: REG };
