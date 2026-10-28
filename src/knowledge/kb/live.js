'use strict';
// v2 KB on the live call: attach the live snapshot to the tenant profile (loaded once per call at
// /voice/incoming prefetch, pinned on the profile object for the whole call) and answer the brain's questions.
const R = require('./reader');
const { docToLegacy } = require('./items');
const ON = /^(1|true|on|yes)$/i;

/** BRAIN_KB_GATE=on: readiness picks the brain (replaces BRAIN_V2_TENANTS / BRAIN_V1_DRAFT_TENANTS). Off/unset = kill switch: the env lists. */
function gateOn(env = process.env) { return ON.test(String(env.BRAIN_KB_GATE || '').trim()); }

// tenant -> { ready, version, readyVersion, brainTarget, at }: written when a profile loads, read by the brain selector.
const REG = new Map();
function note(tenantId, info) { if (tenantId) REG.set(String(tenantId).toLowerCase(), { ...info, at: Date.now() }); }
/** null = gate off (callers use the env lists); true/false = the readiness decision for this business. */
function decision({ env = process.env, tenantId } = {}) {
  if (!gateOn(env)) return null;
  if (tenantId == null) return false;
  const r = REG.get(String(tenantId).toLowerCase());
  return !!(r && r.ready);
}
const isReady = ({ version, readyVersion, brainTarget }) => version != null && readyVersion != null && Number(version) === Number(readyVersion) && String(brainTarget || 'v2') === 'v2';

/**
 * Mutates and returns the profile. extras.kb = { version, readyVersion, brainTarget, doc, bytes, loadMs } | null.
 * Gate on + live snapshot: profile.kb is set and the legacy catalogue fields are projected from the snapshot
 * (the KB is the one source; services_catalog / product_catalog are no longer read on this path).
 */
function attach(profile, kbExtras, { env = process.env, force = false } = {}) {
  if (!profile) return profile;
  const k = kbExtras || null;
  const info = { ready: !!(k && isReady(k)), version: k?.version ?? null, readyVersion: k?.readyVersion ?? null, brainTarget: k?.brainTarget || 'v2' };
  if (!force) note(profile.id, info);
  // the snapshot is read only by a business that passed readiness (the readiness runner forces it to test one)
  if (!k || !k.doc || (!force && (!gateOn(env) || !info.ready))) return profile;
  const handle = R.cached(profile.id, k.version, k.doc, k.bytes);
  if (!handle) return profile;
  profile.kb = { ...info, handle, loadMs: k.loadMs ?? null, items: k.doc.items.length };
  const legacy = docToLegacy(k.doc);
  if (legacy) { profile.servicesCatalog = legacy.servicesCatalog; profile.productCatalog = legacy.productCatalog; profile.kbProjected = true; }
  // the old free-text services line is no longer read on the new path; its stand-in comes from the KB groups
  const groups = (handle.categories || []).filter((c) => c.count > 0).slice(0, 4).map((c) => c.name);
  profile.servicesOffered = groups.length ? groups.join(', ') : null;
  return profile;
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

module.exports = { gateOn, decision, note, attach, handle, knownNumbers, promptIndex, isReady, _REG: REG };
