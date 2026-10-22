"use strict";

// Super Admin Today "quiet" check: the grouped read (one request per chunk of
// businesses) must give exactly the same counts as the old per-business head
// counts, including businesses with zero calls and calls outside the window.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  recentCallCounts,
  countsFromRows,
  chunkIds,
  RECENT_CALLS_CHUNK,
} = require("../dashboard/src/lib/adminRecentCalls.ts");

/** In-memory stand-in for the two PostgREST shapes, counting requests. */
function fakeDb({ tenants, calls }) {
  const stats = { requests: 0 };
  const client = {
    from(table) {
      if (table === "calls") {
        // Old shape: select("id", { count: "exact", head: true }).eq("tenant_id", id).gte("created_at", since)
        const filters = {};
        const q = {
          select() { return q; },
          eq(col, v) { filters[col] = v; return q; },
          gte(col, v) { filters.since = v; return q; },
          then(resolve) {
            stats.requests += 1;
            const count = calls.filter((c) => c.tenant_id === filters.tenant_id && c.created_at >= filters.since).length;
            resolve({ count, error: null });
          },
        };
        return q;
      }
      if (table === "tenants") {
        // New shape: select("id, calls(count)").in("id", ids).gte("calls.created_at", since)
        let ids = [];
        let select = "";
        const q = {
          select(cols) { select = cols; return q; },
          in(col, v) { assert.equal(col, "id"); ids = v; return q; },
          gte(col, since) {
            assert.equal(col, "calls.created_at");
            assert.equal(select, "id, calls(count)");
            stats.requests += 1;
            const data = tenants
              .filter((t) => ids.includes(t.id))
              .map((t) => ({
                id: t.id,
                calls: [{ count: calls.filter((c) => c.tenant_id === t.id && c.created_at >= since).length }],
              }));
            return Promise.resolve({ data, error: null });
          },
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, stats };
}

/** The pre-change implementation (adminToday.ts @200d9c27), kept here for parity. */
async function legacyCounts(client, ids, since) {
  const counted = await Promise.all(
    ids.map(async (id) => {
      const { count, error } = await client
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", id)
        .gte("created_at", since);
      if (error) throw error;
      return [id, count || 0];
    }),
  );
  return new Map(counted);
}

const SINCE = "2026-10-14T19:00:00.000Z";

function fixture(n) {
  const tenants = Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(4, "0")}` }));
  const calls = [];
  tenants.forEach((t, i) => {
    // i % 3 == 0: no calls; i % 3 == 1: only old calls; i % 3 == 2: i recent calls (+ one old).
    if (i % 3 === 1) calls.push({ tenant_id: t.id, created_at: "2026-10-01T00:00:00.000Z" });
    if (i % 3 === 2) {
      calls.push({ tenant_id: t.id, created_at: "2026-10-02T00:00:00.000Z" });
      for (let k = 0; k < i; k += 1) calls.push({ tenant_id: t.id, created_at: "2026-10-20T08:00:00.000Z" });
    }
  });
  // A call exactly on the window edge counts (gte).
  calls.push({ tenant_id: tenants[0].id, created_at: SINCE });
  return { tenants, calls };
}

describe("admin Today recent calls: grouped read", () => {
  for (const n of [1, 6, 7, RECENT_CALLS_CHUNK, RECENT_CALLS_CHUNK + 1, 400]) {
    it(`matches the per-business counts for ${n} businesses, zero-call ones included`, async () => {
      const db = fixture(n);
      const ids = db.tenants.map((t) => t.id);
      const before = fakeDb(db);
      const after = fakeDb(db);
      const old = await legacyCounts(before.client, ids, SINCE);
      const now = await recentCallCounts(after.client, ids, SINCE);
      assert.deepEqual([...now].sort(), [...old].sort());
      assert.ok([...now.values()].some((v) => v === 0) || n === 1, "fixture has zero-call businesses");
      assert.equal(before.stats.requests, n, "old: one request per business");
      assert.equal(after.stats.requests, Math.ceil(n / RECENT_CALLS_CHUNK), "new: one per chunk");
    });
  }

  it("a business the read does not return counts as zero (same as the old head count)", async () => {
    const db = { tenants: [{ id: "a" }], calls: [{ tenant_id: "ghost", created_at: "2026-10-20T00:00:00.000Z" }] };
    const old = await legacyCounts(fakeDb(db).client, ["a", "ghost"], SINCE);
    const now = await recentCallCounts(fakeDb(db).client, ["a", "ghost"], SINCE);
    assert.equal(now.get("a"), 0);
    assert.equal(now.get("ghost"), 0, "no tenants row: not returned, reads 0");
    assert.equal(old.get("a"), 0);
  });

  it("duplicate ids are read once", async () => {
    const db = fixture(3);
    const f = fakeDb(db);
    const now = await recentCallCounts(f.client, ["t0002", "t0002", "t0000"], SINCE);
    assert.equal(now.size, 2);
    assert.equal(f.stats.requests, 1);
  });

  it("a failed read throws, so the page shows the gap instead of marking everyone quiet", async () => {
    const client = { from: () => ({ select: () => ({ in: () => ({ gte: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
    await assert.rejects(() => recentCallCounts(client, ["a"], SINCE), /boom|Object/);
  });

  it("shaping helpers", () => {
    assert.deepEqual(chunkIds(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
    const m = countsFromRows(["a", "b"], [{ id: "a", calls: [{ count: 3 }] }, { id: "z", calls: [{ count: 9 }] }, { id: "b", calls: [] }]);
    assert.deepEqual([...m], [["a", 3], ["b", 0]]);
  });
});
