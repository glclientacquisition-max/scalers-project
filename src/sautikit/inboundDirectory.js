// Cached DID -> tenant directory for the inbound voice webhook.
//
// Prod HD_d3900cbf2b2d (2026-10-09 20:18:19 EAT): POST / took 2051 ms before
// it returned Stream XML. About six sequential Supabase round trips sat on the
// critical path: listActiveTenantDids, packageInboundOpen (resolveTenantId +
// tenants select), upsertCall (resolveTenantId + getCall + upsert). The
// caller heard ringing for all of it, and the greeting started ~4.6 s after
// the first webhook.
//
// This directory answers the same questions from memory: tenant DIDs for the
// caller/callee flip, which tenant owns the number (same rules as
// db.resolveTenantId), the package minute gate, and the line state an
// inactive-tenant gate (#639) needs. It refreshes in the background (stale
// while revalidate). A number it does not know forces one synchronous refresh
// before the webhook rejects it, so a freshly assigned DID is never refused
// from a stale copy.

const { inboundOpen } = require('../billing/packageOverage');

const DEFAULT_TTL_MS = 30_000;

function fastInboundEnabled(env = process.env) {
  const raw = String(env.VOICE_FAST_INBOUND ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function isAssignableDid(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith('pending:')) return false;
  return digitsOf(s).length >= 9;
}

/**
 * @param {{
 *   loadTenants: () => Promise<{ rows: object[], packageColumns?: boolean }>,
 *   ttlMs?: number,
 *   now?: () => number,
 *   defaultTenantId?: string|null,
 *   envDids?: string[],
 *   log?: (msg: string) => void,
 * }} opts
 */
function createInboundDirectory(opts = {}) {
  const loadTenants = opts.loadTenants;
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const defaultTenantId = opts.defaultTenantId || null;
  const envDids = (opts.envDids || []).filter(isAssignableDid);

  /** @type {{ rows: object[], packageColumns: boolean, loadedAt: number } | null} */
  let snap = null;
  /** @type {Promise<typeof snap> | null} */
  let inflight = null;

  function refresh() {
    if (inflight) return inflight;
    const started = now();
    inflight = Promise.resolve()
      .then(() => loadTenants())
      .then((res) => {
        snap = {
          rows: Array.isArray(res?.rows) ? res.rows : [],
          packageColumns: res?.packageColumns !== false,
          loadedAt: now(),
        };
        log(`[inbound-directory] loaded tenants=${snap.rows.length} in ${now() - started}ms`);
        return snap;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  /** Fresh snapshot, or stale one while a refresh runs. Cold start awaits. */
  async function current({ force = false } = {}) {
    if (force || !snap) return refresh();
    if (now() - snap.loadedAt >= ttlMs) {
      refresh().catch((err) => log(`[inbound-directory] refresh failed: ${err?.message || err}`));
    }
    return snap;
  }

  function tenantDids(s) {
    const fromDb = (s?.rows || [])
      .filter((r) => r && r.is_active !== false)
      .map((r) => r.sautikit_virtual_number)
      .filter(isAssignableDid);
    return [...new Set([...fromDb, ...envDids])];
  }

  // Same rules as db.resolveTenantId: exact DID on any row, then digit match
  // on active rows, trying the callee then the caller.
  function findTenant(s, { toNumber, fromNumber }) {
    const rows = s?.rows || [];
    if (defaultTenantId) {
      return rows.find((r) => r.id === defaultTenantId) || { id: defaultTenantId };
    }
    for (const candidate of [toNumber, fromNumber].filter(Boolean)) {
      const exact = rows.find((r) => r.sautikit_virtual_number === candidate);
      if (exact) return exact;
      const digits = digitsOf(candidate);
      if (!digits) continue;
      const hit = rows.find(
        (r) => r.is_active !== false && digitsOf(r.sautikit_virtual_number) === digits
      );
      if (hit) return hit;
    }
    return null;
  }

  function packageGate(s, tenant) {
    if (!tenant || !s?.packageColumns || tenant.minutes_included === undefined) {
      return { open: true, reason: s?.packageColumns ? 'unassigned' : 'columns_missing' };
    }
    return inboundOpen({
      minutesIncluded: tenant.minutes_included,
      secondsUsed: tenant.seconds_used,
      onDemand: Boolean(tenant.on_demand_usage_enabled),
    });
  }

  /**
   * @param {{ toNumber?: string, fromNumber?: string }} numbers raw webhook numbers
   * @param {(n: { fromNumber: string, toNumber: string, tenantDids: string[] }) => { fromNumber: string, toNumber: string, swapped?: boolean }} [correct]
   */
  async function lookup(numbers = {}, correct) {
    const started = now();
    let s = await current();
    let refreshed = false;
    const resolve = (snapshot) => {
      const dids = tenantDids(snapshot);
      const fixed = typeof correct === 'function'
        ? correct({ fromNumber: numbers.fromNumber, toNumber: numbers.toNumber, tenantDids: dids })
        : { fromNumber: numbers.fromNumber, toNumber: numbers.toNumber, swapped: false };
      const tenant = findTenant(snapshot, fixed);
      return { dids, fixed, tenant };
    };
    let r = resolve(s);
    const hasNumber = Boolean(r.fixed.toNumber || r.fixed.fromNumber);
    if (!r.tenant && hasNumber && !defaultTenantId) {
      // Unknown number: re-read once before rejecting (a DID assigned in the
      // last TTL window must answer).
      s = await current({ force: true });
      refreshed = true;
      r = resolve(s);
    }
    const tenant = r.tenant;
    return {
      tenantDids: r.dids,
      fromNumber: r.fixed.fromNumber,
      toNumber: r.fixed.toNumber,
      swapped: Boolean(r.fixed.swapped),
      tenantId: tenant?.id || null,
      unassigned: !tenant && hasNumber && !defaultTenantId,
      // No number at all: legacy falls back to the first active tenant inside
      // upsertCall; leave tenantId null and let it.
      gate: packageGate(s, tenant),
      line: tenant
        ? {
            active: tenant.is_active !== false,
            archived: Boolean(tenant.archived_at),
          }
        : null,
      refreshed,
      lookupMs: now() - started,
      ageMs: s ? now() - s.loadedAt : null,
    };
  }

  return {
    lookup,
    refresh,
    current,
    get loadedAt() {
      return snap ? snap.loadedAt : null;
    },
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  fastInboundEnabled,
  createInboundDirectory,
};
