'use strict';

// Closed-tenant guard (VOICE_CLOSED_TENANT_GUARD, default on).
//
// The #639/#651 inbound gate stops an archived, suspended or is_active=false
// business from taking a call. This guard covers the paths that act on a
// tenant outside that gate: every Voice SMS / WhatsApp / email (through
// sendLedger.beginInstanceSend), the Desk re-ping (/internal/desk/escalate),
// Brain tool writes and live-transfer Dial on a call that was already up when
// the line closed, and the greeting warm-up. One predicate decides
// (isTenantLineInactive via tenantLineState), so a new closed state plugs in
// once in src/sautikit/inactiveTenantGate.js.
//
// A lookup error fails open with a log, the same as the inbound gate: a
// database hiccup must never silence a live business.
//
// Off (VOICE_CLOSED_TENANT_GUARD=off) restores the old behaviour everywhere.

const { tenantLineState, isTenantLineInactive } = require('./inactiveTenantGate');

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 2000;
const OPEN_NO_ID = Object.freeze({ closed: false, reason: 'no_tenant_id', tenantId: null });

/** Reads process.env.VOICE_CLOSED_TENANT_GUARD (default on). */
function closedTenantGuardEnabled(env = process.env) {
  const raw = String(env.VOICE_CLOSED_TENANT_GUARD ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['off', '0', 'false', 'no'].includes(raw);
}

/**
 * Line state for one tenant from its row(s). Same rules as the inbound gate.
 * @returns {{ closed: boolean, reason: string, tenantId: string|null }}
 */
function lineStateForRows(rows, tenantId) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!list.length) return { closed: false, reason: 'no_tenant', tenantId: tenantId || null };
  return tenantLineState(list);
}

/**
 * Cached per-tenant line lookup. loadRows(tenantId) resolves { data, error }
 * like a Supabase select. Successful answers are cached for ttlMs; a failed
 * lookup is not cached and answers open.
 */
function createTenantLineCache({
  loadRows,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  log = (msg) => console.warn(msg),
  max = MAX_ENTRIES,
} = {}) {
  const entries = new Map();
  const inFlight = new Map();

  function remember(id, state) {
    entries.delete(id);
    entries.set(id, { state, until: now() + ttlMs });
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }

  async function lookup(id) {
    try {
      const { data, error } = (await loadRows(id)) || {};
      if (error) throw error;
      const state = lineStateForRows(data, id);
      remember(id, state);
      return state;
    } catch (err) {
      log(`[closed-tenant] line lookup failed tenant=${id} (treating as open): ${err?.message || err}`);
      return { closed: false, reason: 'lookup_failed', tenantId: id };
    }
  }

  /** @returns {Promise<{ closed: boolean, reason: string, tenantId: string|null }>} */
  async function lineFor(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id) return OPEN_NO_ID;
    const hit = entries.get(id);
    if (hit && hit.until > now()) return hit.state;
    if (inFlight.has(id)) return inFlight.get(id);
    const p = lookup(id).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    return p;
  }

  function invalidate(tenantId) {
    entries.delete(String(tenantId || '').trim());
  }

  function clear() {
    entries.clear();
    inFlight.clear();
  }

  return { lineFor, invalidate, clear };
}

/**
 * Ask db.tenantLineClosed when the guard is on and a tenant id is known.
 * Never throws: a missing lookup or an error answers open.
 */
async function tenantLineForAction(tenantId, { env = process.env, db = null, log = (m) => console.warn(m) } = {}) {
  const id = String(tenantId || '').trim();
  if (!id || !closedTenantGuardEnabled(env)) return OPEN_NO_ID;
  try {
    const store = db || require('../db');
    if (typeof store?.tenantLineClosed !== 'function') return { closed: false, reason: 'no_lookup', tenantId: id };
    const state = await store.tenantLineClosed(id);
    return state && typeof state === 'object' ? state : { closed: false, reason: 'no_lookup', tenantId: id };
  } catch (err) {
    log(`[closed-tenant] line check failed tenant=${id} (treating as open): ${err?.message || err}`);
    return { closed: false, reason: 'lookup_failed', tenantId: id };
  }
}

/** Plain-language refusal for an owner-facing or ops route. */
function closedLineRefusal(state) {
  const why = state?.reason === 'archived' ? 'archived' : state?.reason === 'suspended' ? 'suspended' : 'inactive';
  return {
    ok: false,
    reason: 'tenant_line_closed',
    lineState: why,
    tenantId: state?.tenantId || null,
    message: `This business line is ${why}. Nothing was sent.`,
  };
}

/** Greeting warm-up list: drop closed rows (guard on) or keep the old rule (guard off). */
function warmableTenantRows(rows, env = process.env) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!closedTenantGuardEnabled(env)) return list.filter((r) => r.is_active !== false && !r.archived_at);
  return list.filter((r) => !isTenantLineInactive(r));
}

module.exports = {
  DEFAULT_TTL_MS,
  closedTenantGuardEnabled,
  lineStateForRows,
  createTenantLineCache,
  tenantLineForAction,
  closedLineRefusal,
  warmableTenantRows,
};
