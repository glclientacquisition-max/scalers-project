'use strict';

// Permanent demo visitor markers. A row means this salted hash has been
// used. grants_remaining is the only way back in. There is no clock reset.
// DEMO_VISITOR_PERSIST=on reloads docs/supabase/demo_visitor_use.sql.
// That file is not applied by this process. The flag off keeps markers in
// memory, and a restart drops them. The raw IP is never stored.

const { sessionsPerVisitor } = require('./flags');

const HASH_RE = /^[0-9a-f]{64}$/;
const COLUMNS = 'visitor_hash,kind,first_used_at,grants_remaining,granted_by,granted_at';

function copy(row) {
  if (!row) return null;
  return {
    visitor_hash: row.visitor_hash,
    kind: row.kind,
    first_used_at: row.first_used_at || null,
    grants_remaining: Math.max(0, Math.round(Number(row.grants_remaining) || 0)),
    granted_by: row.granted_by || null,
    granted_at: row.granted_at || null,
  };
}

function exhausted(row) {
  return Boolean(row) && row.grants_remaining < 1;
}

function stamp(at) {
  return new Date(at).toISOString();
}

function consume(row, kind, hash, allowance, at) {
  if (!row) {
    return {
      visitor_hash: hash,
      kind,
      first_used_at: stamp(at),
      grants_remaining: Math.max(0, allowance - 1),
      granted_by: null,
      granted_at: null,
    };
  }
  return {
    ...row,
    first_used_at: row.first_used_at || stamp(at),
    grants_remaining: Math.max(0, row.grants_remaining - 1),
  };
}

function createMemoryVisitorStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async load() {
      return [...rows.values()].map((row) => copy(row));
    },
    async save(row) {
      const saved = copy(row);
      if (!saved || !HASH_RE.test(saved.visitor_hash)) throw new Error('demo_visitor_use');
      rows.set(saved.visitor_hash, saved);
    },
    async remove(hash) {
      rows.delete(hash);
    },
  };
}

function createSupabaseVisitorStore(client) {
  function db() {
    if (client) return client;
    return require('../lib/supabaseClient').supabase;
  }
  return {
    kind: 'supabase',
    async load() {
      const { data, error } = await db().from('demo_visitor_use').select(COLUMNS);
      if (error) throw new Error('demo_visitor_use');
      return data || [];
    },
    async save(row) {
      const saved = copy(row);
      if (!saved || saved.ip || saved.device_id) throw new Error('demo_visitor_use');
      const { error } = await db().from('demo_visitor_use').upsert(saved, { onConflict: 'visitor_hash' });
      if (error) throw new Error('demo_visitor_use');
    },
    async remove(hash) {
      const { error } = await db().from('demo_visitor_use').delete().eq('visitor_hash', hash);
      if (error) throw new Error('demo_visitor_use');
    },
  };
}

function createVisitorBook(opts = {}) {
  const store = opts.store || createMemoryVisitorStore();
  const envOf = () => (opts.envOf ? opts.envOf() : (opts.env || {}));
  const now = opts.now || (() => Date.now());
  const log = opts.log || (() => {});
  const rows = new Map();
  let loaded = false;
  let loading = null;
  let warned = false;

  function fail(kind) {
    if (warned) return;
    warned = true;
    try { log(`demo_visitor_${kind} ${JSON.stringify({ reason: 'store' })}`); } catch { /* ignore */ }
  }

  async function ready() {
    if (loaded) return;
    if (!loading) {
      loading = store.load().then((list) => {
        for (const raw of list || []) {
          const row = copy(raw);
          if (!row || !HASH_RE.test(row.visitor_hash)) continue;
          if (row.kind !== 'ip' && row.kind !== 'device') continue;
          rows.set(row.visitor_hash, row);
        }
        loaded = true;
      }).catch(() => {
        fail('load');
        loaded = true;
      });
    }
    await loading;
  }

  function allowance() {
    return sessionsPerVisitor(envOf());
  }

  async function blocked(ipHash, deviceHash) {
    await ready();
    if (ipHash && exhausted(rows.get(ipHash))) return true;
    if (deviceHash && exhausted(rows.get(deviceHash))) return true;
    return false;
  }

  async function persist(row) {
    try {
      await store.save(copy(row));
    } catch {
      fail('save');
    }
  }

  async function claim(ipHash, deviceHash, at) {
    await ready();
    if (exhausted(rows.get(ipHash)) || exhausted(rows.get(deviceHash))) {
      return { ok: false, reason: 'used' };
    }
    const before = {
      ip: copy(rows.get(ipHash)),
      device: copy(rows.get(deviceHash)),
    };
    const limit = allowance();
    const when = Number.isFinite(at) ? at : now();
    const nextIp = consume(before.ip, 'ip', ipHash, limit, when);
    const nextDevice = consume(before.device, 'device', deviceHash, limit, when);
    rows.set(ipHash, copy(nextIp));
    rows.set(deviceHash, copy(nextDevice));
    await persist(nextIp);
    await persist(nextDevice);
    return { ok: true, receipt: { ipHash, deviceHash, before } };
  }

  async function undo(receipt) {
    if (!receipt) return;
    await ready();
    for (const side of ['ip', 'device']) {
      const hash = receipt[side === 'ip' ? 'ipHash' : 'deviceHash'];
      const prev = receipt.before && receipt.before[side];
      if (!hash) continue;
      if (!prev) {
        rows.delete(hash);
        try { await store.remove(hash); } catch { fail('save'); }
      } else {
        rows.set(hash, copy(prev));
        await persist(prev);
      }
    }
  }

  async function grant({ visitorHash, kind, by, at }) {
    await ready();
    const hash = String(visitorHash || '').trim().toLowerCase();
    if (!HASH_RE.test(hash) || (kind !== 'ip' && kind !== 'device')) {
      return { ok: false, reason: 'invalid' };
    }
    const prev = rows.get(hash);
    if (prev && prev.kind !== kind) return { ok: false, reason: 'invalid' };
    const when = stamp(Number.isFinite(at) ? at : now());
    const actor = String(by || 'ops').trim().slice(0, 80) || 'ops';
    const next = prev
      ? { ...prev, grants_remaining: prev.grants_remaining + 1, granted_by: actor, granted_at: when }
      : {
        visitor_hash: hash,
        kind,
        first_used_at: null,
        grants_remaining: 1,
        granted_by: actor,
        granted_at: when,
      };
    rows.set(hash, copy(next));
    await persist(next);
    return { ok: true, grants_remaining: next.grants_remaining };
  }

  return { ready, blocked, claim, undo, grant, rows };
}

module.exports = {
  HASH_RE,
  createMemoryVisitorStore,
  createSupabaseVisitorStore,
  createVisitorBook,
};
