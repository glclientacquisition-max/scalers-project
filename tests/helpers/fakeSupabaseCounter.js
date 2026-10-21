'use strict';

// In-memory Supabase stand-in for query-count tests. No network, no writes
// anywhere but this process. Every awaited query or rpc is one round trip:
// it is logged ({ table|rpc, op, filters }) and resolves after latencyMs, so
// serial vs parallel wall time can be measured.
//
//   const fake = createFakeSupabase({ tables: { tenants: [...] }, latencyMs: 40 });
//   require.cache[require.resolve('../src/lib/supabaseClient')] = { exports: { supabase: fake.client } };

function splitColumns(cols) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(cols || '*')) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(row, cols, missingColumn) {
  const list = splitColumns(cols);
  if (list.length === 1 && list[0] === '*') return { ...row };
  const out = {};
  for (const item of list) {
    const [alias, real] = item.includes(':') ? item.split(':').map((s) => s.trim()) : [item, item];
    if (missingColumn && missingColumn(real)) {
      const err = new Error(`column tenants.${real} does not exist`);
      err.code = '42703';
      throw err;
    }
    if (real in row) out[alias] = row[real];
  }
  return out;
}

function createFakeSupabase({
  tables = {},
  latencyMs = 0,
  rpcs = {},
  missingColumns = {},
} = {}) {
  const log = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const wait = () =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve();

  async function roundTrip(entry, run) {
    log.push(entry);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await wait();
      return run();
    } finally {
      inFlight -= 1;
    }
  }

  function builder(table) {
    const state = {
      table,
      op: 'select',
      cols: '*',
      filters: [],
      order: null,
      limit: null,
      range: null,
      single: null,
      payload: null,
      returning: null,
      upsertOn: null,
    };
    const rowsOf = () => (tables[table] = tables[table] || []);
    const matches = (row) =>
      state.filters.every(([kind, col, value]) => {
        if (kind === 'eq') return row[col] === value;
        if (kind === 'in') return value.includes(row[col]);
        if (kind === 'gte') return row[col] >= value;
        return true;
      });
    const missingFor = (col) => (missingColumns[table] || []).includes(col);

    function execute() {
      try {
        if (state.op === 'select') {
          let rows = rowsOf().filter(matches);
          if (state.order) {
            const { col, ascending } = state.order;
            rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
          }
          if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
          if (state.limit != null) rows = rows.slice(0, state.limit);
          rows = rows.map((r) => project(r, state.cols, missingFor));
          if (state.single) return { data: rows[0] || null, error: null };
          return { data: rows, error: null };
        }
        if (state.op === 'update') {
          const hit = rowsOf().filter(matches);
          for (const row of hit) Object.assign(row, state.payload);
          const out = hit.map((r) => project(r, state.returning || '*'));
          return { data: state.single ? out[0] || null : out, error: null };
        }
        if (state.op === 'upsert') {
          const key = state.upsertOn;
          let row = rowsOf().find((r) => r[key] === state.payload[key]);
          if (row) Object.assign(row, state.payload);
          else {
            row = { id: `${table}-${rowsOf().length + 1}`, ...state.payload };
            rowsOf().push(row);
          }
          return { data: project(row, state.returning || '*'), error: null };
        }
        if (state.op === 'insert') {
          const list = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((r, i) => ({
            id: `${table}-${rowsOf().length + i + 1}`,
            ...r,
          }));
          rowsOf().push(...list);
          return { data: list, error: null };
        }
        if (state.op === 'delete') {
          tables[table] = rowsOf().filter((r) => !matches(r));
          return { data: null, error: null };
        }
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
      return { data: null, error: null };
    }

    const q = {
      select(cols) {
        if (state.op === 'select') state.cols = cols || '*';
        else state.returning = cols || '*';
        return q;
      },
      update(payload) {
        state.op = 'update';
        state.payload = payload;
        return q;
      },
      upsert(payload, opts = {}) {
        state.op = 'upsert';
        state.payload = payload;
        state.upsertOn = opts.onConflict || 'id';
        return q;
      },
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return q;
      },
      delete() {
        state.op = 'delete';
        return q;
      },
      eq(col, value) {
        state.filters.push(['eq', col, value]);
        return q;
      },
      in(col, values) {
        state.filters.push(['in', col, values]);
        return q;
      },
      gte(col, value) {
        state.filters.push(['gte', col, value]);
        return q;
      },
      order(col, opts = {}) {
        state.order = { col, ascending: opts.ascending !== false };
        return q;
      },
      limit(n) {
        state.limit = n;
        return q;
      },
      range(a, b) {
        state.range = [a, b];
        return q;
      },
      maybeSingle() {
        state.single = 'maybe';
        return q;
      },
      single() {
        state.single = 'one';
        return q;
      },
      then(resolve, reject) {
        const entry = {
          table,
          op: state.op,
          cols: state.op === 'select' ? state.cols : state.returning,
          filters: state.filters.map(([k, c]) => `${k}:${c}`).join(','),
        };
        return roundTrip(entry, execute).then(resolve, reject);
      },
    };
    return q;
  }

  const client = {
    from: (table) => builder(table),
    rpc(name, args) {
      return {
        then(resolve, reject) {
          return roundTrip({ rpc: name, op: 'rpc' }, () => {
            const fn = rpcs[name];
            if (!fn) {
              return {
                data: null,
                error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` },
              };
            }
            try {
              return { data: fn(args, tables), error: null };
            } catch (err) {
              return { data: null, error: { message: err.message } };
            }
          }).then(resolve, reject);
        },
      };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };

  return {
    client,
    tables,
    log,
    reset() {
      log.length = 0;
      maxInFlight = 0;
    },
    count(pred = () => true) {
      return log.filter(pred).length;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

module.exports = { createFakeSupabase, splitColumns };
