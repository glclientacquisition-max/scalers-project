'use strict';
// v2 KB on the live call: attach the live snapshot to the tenant profile (loaded once per call at
// /voice/incoming prefetch, pinned on the profile object for the whole call) and answer the brain's questions.
const R = require('./reader');
const { docToLegacy } = require('./items');
const { isKbLive, kbQuality, brainMode, kbGateOn } = require('./kbLive');

/** BRAIN_KB_GATE=on: the KB brain answers every business (readiness is a quality signal, kb/kbLive.js). Off/unset = kill switch: the env lists (removed in P2). */
function gateOn(env = process.env) { return kbGateOn(env.BRAIN_KB_GATE); }

// tenant -> { version, readyVersion, quality, brainMode, facts, at }: written when a profile loads.
const REG = new Map();
function note(tenantId, info) { if (tenantId) REG.set(String(tenantId).toLowerCase(), { ...info, at: Date.now() }); }
/** null = gate off (callers use the env lists); gate on: true for every business (false only with no business id). */
function decision({ env = process.env, tenantId } = {}) {
  const d = isKbLive(null, { gate: env.BRAIN_KB_GATE });
  if (d.reason === 'gate_off') return null;
  return tenantId != null && String(tenantId).trim() !== '';
}
/** Readiness / quality reason for a business seen on this replica (never a brain switch). */
function quality(tenantId) {
  const r = tenantId == null ? null : REG.get(String(tenantId).toLowerCase());
  return kbQuality(r ? r.facts : null);
}
/** The live snapshot passed readiness (quality signal only). */
const isReady = (k) => kbQuality(k) === 'ready';

/**
 * Mutates and returns the profile. extras.kb = { version, readyVersion, brainMode, doc, bytes, loadMs } | null.
 * Gate on: any business with a live snapshot gets profile.kb (readiness does not gate it; an empty snapshot is fine)
 * and the legacy catalogue fields projected from it. profile.brainMode ('full' | 'safe') is pinned for the call.
 */
function attach(profile, kbExtras, { env = process.env, force = false } = {}) {
  if (!profile) return profile;
  const k = kbExtras || null;
  const facts = k ? { version: k.version ?? null, readyVersion: k.readyVersion ?? null, brainMode: k.brainMode || 'full', brainModeSource: k.brainModeSource || null } : null;
  const info = { ready: isReady(facts), version: facts?.version ?? null, readyVersion: facts?.readyVersion ?? null, quality: kbQuality(facts) };
  profile.brainMode = brainMode(facts, { safeEnv: env.BRAIN_SAFE_MODE });
  if (!force) note(profile.id, { ...info, facts, brainMode: profile.brainMode.mode });
  // gate off = kill switch (env lists, no snapshot). The readiness runner forces an attach to test a snapshot.
  if (!k || !k.doc || (!force && !gateOn(env))) return profile;
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

module.exports = { gateOn, decision, quality, note, attach, handle, knownNumbers, promptIndex, isReady, _REG: REG };
