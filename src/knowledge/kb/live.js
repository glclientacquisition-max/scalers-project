'use strict';
// v2 KB on the live call: attach the live snapshot to the tenant profile (loaded once per call at
// /voice/incoming prefetch, pinned on the profile object for the whole call) and answer the brain's questions.
const R = require('./reader');
const { docToLegacy } = require('./items');
const { isKbLive, kbGateOn } = require('./kbLive');

/** BRAIN_KB_GATE=on: readiness (kb/kbLive.js isKbLive, the shared predicate) picks the brain (replaces BRAIN_V2_TENANTS / BRAIN_V1_DRAFT_TENANTS). Off/unset = kill switch: the env lists. */
function gateOn(env = process.env) { return kbGateOn(env.BRAIN_KB_GATE); }

// tenant -> { ready, version, readyVersion, brainTarget, at }: written when a profile loads, read by the brain selector.
const REG = new Map();
function note(tenantId, info) { if (tenantId) REG.set(String(tenantId).toLowerCase(), { ...info, at: Date.now() }); }
/** null = gate off (callers use the env lists); true/false = the readiness decision for this business. */
function decision({ env = process.env, tenantId } = {}) {
  const r = tenantId == null ? null : REG.get(String(tenantId).toLowerCase());
  const d = isKbLive(r ? r.facts : null, { gate: env.BRAIN_KB_GATE });
  return d.reason === 'gate_off' ? null : d.live;
}
/** Readiness alone (gate aside): the shared predicate with the gate forced on. */
const isReady = (k) => isKbLive(k, { gate: true }).live;

/**
 * Mutates and returns the profile. extras.kb = { version, readyVersion, brainTarget, doc, bytes, loadMs } | null.
 * Gate on + live snapshot: profile.kb is set and the legacy catalogue fields are projected from the snapshot
 * (the KB is the one source; services_catalog / product_catalog are no longer read on this path).
 */
function attach(profile, kbExtras, { env = process.env, force = false } = {}) {
  if (!profile) return profile;
  const k = kbExtras || null;
  const info = { ready: !!(k && isReady(k)), version: k?.version ?? null, readyVersion: k?.readyVersion ?? null, brainTarget: k?.brainTarget || 'v2' };
  // the registry keeps the facts (not a precomputed answer) so decision() runs the shared predicate itself
  if (!force) note(profile.id, { ...info, facts: k ? { version: info.version, readyVersion: info.readyVersion, brainTarget: info.brainTarget } : null });
  // the snapshot is read only by a business that passed readiness (the readiness runner forces it to test one)
  if (!k || !k.doc || (!force && (!gateOn(env) || !info.ready))) return profile;
  const handle = R.cached(profile.id, k.version, k.doc, k.bytes);
  if (!handle) return profile;
  profile.kb = { ...info, handle, loadMs: k.loadMs ?? null, items: k.doc.items.length };
  const legacy = docToLegacy(k.doc);
  if (legacy) { profile.servicesCatalog = legacy.servicesCatalog; profile.productCatalog = legacy.productCatalog; profile.kbProjected = true; }
  // the old free-text services line (tenants.services_offered, now a derived copy) is not read on the KB path:
  // every caller-facing reader goes through kb/source.js (groups for the greeting, item descriptions for notes)
  profile.servicesOffered = null;
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
