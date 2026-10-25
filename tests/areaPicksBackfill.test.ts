import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("to_rows SQL is transactional and renames v0 without dropping", () => {
  const sql = readFileSync(new URL("../docs/supabase/tenant_area_picks_to_rows.sql", import.meta.url), "utf8");
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.match(sql, /rename to tenant_area_picks_v0/i);
  assert.match(sql, /column_name = 'picks'/i);
  assert.match(sql, /on conflict \(tenant_id, node\) do nothing/i);
  const down = readFileSync(new URL("../docs/supabase/tenant_area_picks_to_rows_down.sql", import.meta.url), "utf8");
  assert.match(down, /drop table if exists public\.tenant_area_picks/i);
  assert.match(down, /rename to tenant_area_picks/i);
});

test("v0 jsonb picks document maps to row-shaped picks", async () => {
  const { rowsFromV0TenantRow } = await import("../dashboard/src/lib/areaPicksV0ToRows.ts");
  const at = "2026-10-25T12:00:00.000Z";
  const rows = rowsFromV0TenantRow({
    tenant_id: "11111111-1111-4111-8111-111111111111",
    tree_version: "ke-areas-2026-10-24.1",
    picks: {
      version: 1,
      tree_version: "ignored-when-column-set",
      picks: [
        { node: "county:nairobi", serve: true, fee_kes: 200, note: " CBD only " },
        { node: "estate:nairobi:kibera", serve: false, fee_kes: 99, note: "nope" },
        { node: "town:kajiado:kitengela", serve: true, fee_ksh: 500, note: "Weekends" },
      ],
    },
    moved_from: ["county:nairobi"],
    confirmed_at: at,
    updated_by: "22222222-2222-4222-8222-222222222222",
    updated_at: at,
  });
  assert.equal(rows.length, 3);
  const nairobi = rows.find((r) => r.node === "county:nairobi");
  assert.deepEqual(nairobi, {
    tenant_id: "11111111-1111-4111-8111-111111111111",
    node: "county:nairobi",
    serve: true,
    fee_kes: 200,
    note: "CBD only",
    confirmed_at: at,
    tree_version: "ke-areas-2026-10-24.1",
    moved_from: ["county:nairobi"],
    updated_by: "22222222-2222-4222-8222-222222222222",
    updated_at: at,
  });
  const kibera = rows.find((r) => r.node === "estate:nairobi:kibera");
  assert.equal(kibera?.serve, false);
  assert.equal(kibera?.fee_kes, null);
  assert.equal(kibera?.note, null);
  const kit = rows.find((r) => r.node === "town:kajiado:kitengela");
  assert.equal(kit?.fee_kes, 500);
  assert.equal(kit?.note, "Weekends");
  // missing serve defaults to true
  const def = rowsFromV0TenantRow({
    tenant_id: "11111111-1111-4111-8111-111111111111",
    tree_version: null,
    picks: { version: 1, picks: [{ node: "ke" }] },
    moved_from: null,
    confirmed_at: null,
    updated_by: null,
    updated_at: at,
  });
  assert.equal(def[0].serve, true);
  assert.equal(def[0].tree_version, "ke-areas-2026-10-24.1");
  assert.equal(def[0].confirmed_at, null);
});

test("DDL uses per-pick columns (Brain #960 contract)", () => {
  const ddl = readFileSync(new URL("../docs/supabase/tenant_area_picks.sql", import.meta.url), "utf8");
  assert.match(ddl, /\bnode text not null/);
  assert.match(ddl, /\bserve boolean not null/);
  assert.match(ddl, /\bfee_kes integer/);
  assert.match(ddl, /\bnote text/);
  assert.match(ddl, /\bconfirmed_at timestamptz/);
  assert.doesNotMatch(ddl, /\bpicks jsonb/);
});

test("backfill SQL is idempotent and names legacy sources", () => {
  const sql = readFileSync(new URL("../docs/supabase/tenant_area_picks_backfill.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into public\.tenant_area_picks/i);
  assert.match(sql, /on conflict \(tenant_id, node\) do nothing/i);
  assert.match(sql, /coverage_areas/);
  assert.match(sql, /service_areas/);
  assert.match(sql, /confirmed_at/);
  const down = readFileSync(new URL("../docs/supabase/tenant_area_picks_backfill_down.sql", import.meta.url), "utf8");
  assert.match(down, /delete from public\.tenant_area_picks/i);
});

test("migrate: legacy ids and fees land as unconfirmed picks", async () => {
  const { tenantAreaPicksFromLegacy } = await import("../dashboard/src/lib/areaPicksMigrate.ts");
  const { resolveArea, matchAreaText } = await import("../dashboard/src/lib/areaPicks.ts");
  const row = tenantAreaPicksFromLegacy({
    business_policies: { coverage_areas: ["county:nairobi", "place:kitengela"] },
    service_areas: {
      areas: [{ id: "place:kitengela", serve: true, fee_ksh: 500, note: "Weekends only" }],
      anywhere_kenya: false,
    },
  });
  assert.ok(row.moved_from.includes("county:nairobi"));
  assert.ok(row.picks.picks.some((p) => p.node === "county:nairobi" && p.serve));
  const kit = matchAreaText("Kitengela");
  assert.ok(kit);
  const r = resolveArea(row.picks, kit!.id);
  assert.equal(r.covered, true);
  assert.equal(r.fee_kes, 500);
  assert.equal(r.note, "Weekends only");
});

test("migrate: anywhere in Kenya -> serve ke with fee", async () => {
  const { tenantAreaPicksFromLegacy } = await import("../dashboard/src/lib/areaPicksMigrate.ts");
  const { resolveArea } = await import("../dashboard/src/lib/areaPicks.ts");
  const row = tenantAreaPicksFromLegacy({
    business_policies: { coverage_outside: { anywhere_kenya: true, fee_ksh: 1200 } },
    service_areas: { areas: [], anywhere_kenya: true, outside_fee_ksh: 1200 },
  });
  const r = resolveArea(row.picks, "ke");
  assert.equal(r.covered, true);
  assert.equal(r.fee_kes, 1200);
});
