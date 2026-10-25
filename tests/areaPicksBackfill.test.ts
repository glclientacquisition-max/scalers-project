import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("backfill SQL is idempotent and names legacy sources", () => {
  const sql = readFileSync(new URL("../docs/supabase/tenant_area_picks_backfill.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into public\.tenant_area_picks/i);
  assert.match(sql, /not exists \(select 1 from public\.tenant_area_picks/i);
  assert.match(sql, /coverage_areas/);
  assert.match(sql, /service_areas/);
  assert.match(sql, /confirmed_at/);
  assert.match(sql, /insert[\s\S]+null,\s*\n\s*now\(\)/i);
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
