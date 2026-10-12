import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as sa from "../dashboard/src/lib/serviceAreas.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261012150000_locations_service_areas.sql";

test("normalize: drops unknown ids, duplicates and bad numbers; caps at 40", () => {
  const v = sa.normalizeServiceAreas({
    areas: [
      { id: "place:ruaka", modes: ["delivery"], fee_mode: "fixed", fee_ksh: "200", eta: " same day ", confirmed: true, source: "owner" },
      { id: "place:ruaka", modes: ["delivery"] },
      { id: "place:atlantis", modes: ["delivery"] },
      { id: "county:nairobi", modes: ["teleport"], fee_mode: "fixed", fee_ksh: -5 },
    ],
    delivered_by: ["rider", "drone"],
    rider_paid: "on_arrival",
  });
  assert.equal(v.areas.length, 2);
  assert.equal(v.areas[0].fee_ksh, 200);
  assert.equal(v.areas[0].eta, "same day");
  assert.deepEqual(v.areas[1].modes, ["delivery"], "unknown mode falls back to the default");
  assert.equal(v.areas[1].fee_mode, "ask", "a fixed fee without a valid amount becomes Ask");
  assert.deepEqual(v.delivered_by, ["rider"]);
});

test("backfill from coverage ids: Ask fee, unconfirmed, mode by business type", () => {
  const home = sa.serviceAreasFromCoverage(["county:nairobi", "place:ruaka"], "home_services");
  assert.deepEqual(home.areas.map((a) => [a.id, a.modes[0], a.fee_mode, a.confirmed, a.source]), [
    ["county:nairobi", "visit", "ask", false, "import"],
    ["place:ruaka", "visit", "ask", false, "import"],
  ]);
  assert.equal(sa.serviceAreasFromCoverage(["county:nairobi"], "retail").areas[0].modes[0], "delivery");
  assert.equal(sa.serviceAreasFromCoverage(null, "retail"), null);
});

test("coverage ids stay in sync for the voice server", () => {
  const v = sa.normalizeServiceAreas({ areas: [{ id: "place:ruaka" }, { id: "county:kiambu", modes: ["pickup"] }] });
  assert.deepEqual(sa.coverageIdsFrom(v), ["place:ruaka", "county:kiambu"]);
  assert.equal(sa.coverageIdsFrom(sa.normalizeServiceAreas({ areas: [] })), null, "no areas = no directory");
  assert.equal(sa.coverageIdsFrom(null), null);
});

test("prompt: a fee is quoted only when the owner confirmed it", () => {
  const v = sa.normalizeServiceAreas({
    areas: [
      { id: "place:ruaka", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 200, eta: "same day", source: "owner", confirmed: true },
      { id: "place:kitengela", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 500, source: "import", confirmed: false },
      { id: "county:nairobi", modes: ["delivery"], fee_mode: "free", source: "owner", confirmed: true, min_order_ksh: 1000 },
    ],
    delivered_by: ["rider"],
    rider_paid: "on_arrival",
  });
  const text = sa.formatServiceAreasForCompiler(v);
  assert.match(text, /Ruaka: delivery, KSh 200, same day/);
  assert.match(text, /Kitengela: delivery, fee confirmed on callback/);
  assert.doesNotMatch(text, /KSh 500/);
  assert.match(text, /Nairobi: delivery, free, orders from KSh 1,000/);
  assert.match(text, /rider/i);
  assert.match(text, /pays the rider on arrival/i);
  assert.match(text, /not on this list.*callback/i);
  assert.equal(sa.formatServiceAreasForCompiler(null), "");
});

test("owner-facing sentence reads plainly", () => {
  const v = sa.normalizeServiceAreas({ areas: [{ id: "place:ruaka", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 200, confirmed: true, source: "owner" }] });
  assert.equal(sa.areaSummary(v.areas[0]), "Delivery · KSh 200");
  assert.match(sa.serviceAreasSentence(v), /We deliver to Ruaka for KSh 200\./);
});

test("validate: fixed fee needs an amount; min order is a whole number", () => {
  const errs = sa.validateServiceArea({ id: "place:ruaka", modes: ["delivery"], fee_mode: "fixed", fee_ksh: null, eta: null, min_order_ksh: null, source: "owner", confirmed: true });
  assert.ok(errs.fee_ksh);
  assert.deepEqual(sa.validateServiceArea({ id: "place:ruaka", modes: [], fee_mode: "ask", fee_ksh: null, eta: null, min_order_ksh: null, source: "owner", confirmed: true }).modes ? 1 : 0, 1);
});

test("migration: column, check, backfill, voice-safe; search_path pinned on payments functions", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /add column if not exists service_areas jsonb/);
  assert.match(sql, /service_areas_valid/);
  assert.match(sql, /update public\.tenants[\s\S]*service_areas[\s\S]*coverage_areas/);
  for (const fn of ["payments_valid(jsonb)", "policy_rules_valid(jsonb)", "ke_mobile_valid(text)", "ke_mobile_e164(text)", "payments_to_v2(jsonb)", "parse_payments_text(text)", "service_areas_valid(jsonb)"]) {
    assert.ok(sql.includes(`alter function public.${fn} set search_path`), fn);
  }
});

test("wiring: Locations owns service areas; Policies no longer edits coverage; prompt includes areas", () => {
  const scope = read("dashboard/src/lib/settingsSaveScope.ts");
  assert.match(scope, /locations: \[[^\]]*"serviceAreas"/);
  const actions = read("dashboard/src/app/(desk)/settings/actions.ts");
  assert.ok(actions.includes("formatServiceAreasForCompiler("));
  assert.ok(actions.includes("coverageIdsFrom("), "coverage_areas synced from service areas");
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.ok(form.includes("<ServiceAreasEditor"));
  assert.ok(!form.includes("<CoverageAreaField"), "the coverage picker left Policies");
  const payload = read("dashboard/src/lib/settingsPanelPayload.ts");
  assert.match(payload, /locations: \[[^\]]*"service_areas"/);
  assert.ok(read("dashboard/src/lib/catalogImportRecompile.ts").includes("formatServiceAreasForCompiler("));
});
