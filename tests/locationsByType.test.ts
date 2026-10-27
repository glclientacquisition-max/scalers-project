import test from "node:test";
import assert from "node:assert/strict";

const load = () => import("../dashboard/src/lib/serviceAreas.ts");
const locs = () => import("../dashboard/src/lib/businessLocations.ts");

test("reach defaults from business type", async () => {
  const m = await load();
  assert.equal(m.defaultReach("retail"), "deliver");
  assert.equal(m.defaultReach("home_services"), "visit");
  assert.equal(m.defaultReach("hospitality"), "walk_in");
  assert.equal(m.normalizeServiceAreas({ areas: [] }, "home_services").reach, "visit");
  assert.equal(m.normalizeServiceAreas({ areas: [], reach: "both" }, "retail").reach, "both");
  assert.equal(m.normalizeServiceAreas({ areas: [], reach: "nope" }, "retail").reach, "deliver");
  assert.equal(m.normalizeServiceAreas({ areas: [], no_premises: true }, "home_services").no_premises, true);
});

test("copy follows the type: deliver vs visit vs walk-in", async () => {
  const m = await load();
  assert.equal(m.reachCopy("deliver").title, "Where do you deliver?");
  assert.equal(m.reachCopy("deliver").fee, "Delivery fee");
  assert.equal(m.reachCopy("visit").title, "Where do you visit customers?");
  assert.equal(m.reachCopy("visit").fee, "Call-out fee");
  assert.equal(m.reachCopy("walk_in").title, "Customers come to us");
  assert.equal(m.reachCopy("deliver").riders, true);
  assert.equal(m.reachCopy("visit").riders, false);
  assert.equal(m.reachCopy("walk_in").areas, false);
});

test("prompt: home services say call-out fee and never mention riders", async () => {
  const m = await load();
  const v = { ...m.emptyServiceAreas("home_services"), delivered_by: ["rider"], rider_paid: "on_arrival" };
  const next = m.applyFeeToAreas(v, ["county:nairobi"], { fee_mode: "fixed", fee_ksh: 500, eta: null }, "home_services");
  const p = m.formatServiceAreasForCompiler(next);
  assert.match(p, /Nairobi: home visit, call-out fee KSh 500/);
  assert.doesNotMatch(p, /rider|deliver/i);
  assert.match(m.serviceAreasSentence(next), /call-out fee of KSh 500/);
});

test("prompt: shops keep delivery wording; walk-in skips areas", async () => {
  const m = await load();
  const shop = m.applyFeeToAreas(m.emptyServiceAreas("retail"), ["place:ruaka"], { fee_mode: "fixed", fee_ksh: 200, eta: null }, "retail");
  assert.match(m.formatServiceAreasForCompiler(shop), /Ruaka: delivery, KSh 200/);
  const walk = { ...shop, reach: "walk_in" as const };
  const p = m.formatServiceAreasForCompiler(walk);
  assert.match(p, /Customers come to us/);
  assert.doesNotMatch(p, /Ruaka/);
});

test("mixed: each area is marked delivery or visit", async () => {
  const m = await load();
  let v = { ...m.emptyServiceAreas("retail"), reach: "both" as const };
  v = m.applyFeeToAreas(v, ["place:ruaka"], { fee_mode: "free", fee_ksh: null, eta: null, mode: "delivery" }, "retail");
  v = m.applyFeeToAreas(v, ["place:kitengela"], { fee_mode: "fixed", fee_ksh: 800, eta: null, mode: "visit" }, "retail");
  const p = m.formatServiceAreasForCompiler(v);
  assert.match(p, /Ruaka: delivery, free/);
  assert.match(p, /Kitengela: home visit, call-out fee KSh 800/);
});

test("places: per-branch hours, find-us line, nearest branch, we come to you", async () => {
  const l = await locs();
  const rows = l.normalizeBusinessLocations([
    { label: "CBD", address: "Moi Ave", hours: "Mon-Sat 8am-7pm", directions: "Opposite Hilton" },
    { label: "Westlands", address: "Sarit", hours: "Daily 9-9" },
  ]);
  assert.equal(rows[0].hours, "Mon-Sat 8am-7pm");
  const p = l.formatLocationsForCompiler(rows);
  assert.match(p, /Hours: Mon-Sat 8am-7pm/);
  assert.match(p, /Find us: Opposite Hilton/);
  assert.match(p, /nearest branch/);
  assert.doesNotMatch(l.formatLocationsForCompiler(rows.slice(0, 1)), /nearest branch/);
  const away = l.formatLocationsForCompiler(rows.slice(0, 1), { noPremises: true });
  assert.match(away, /We come to you/);
  assert.match(away, /do not send callers/);
  assert.match(l.formatLocationsForCompiler([], { noPremises: true }), /We come to you/);
});

test("migration accepts reach and no_premises", async () => {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261012150000_locations_service_areas.sql", import.meta.url), "utf8");
  assert.match(sql, /'deliver', 'visit', 'walk_in', 'both'/);
  assert.match(sql, /no_premises/);
});

// The reach choice UI went with ServiceAreasEditor in #964 (43d9870b): Locations is branches only and where the
// business works is AreaPicker. reachCopy / REACH_OPTIONS stay as lib for stored service_areas and are covered above.
test("UI wiring: branch hours in Locations", async () => {
  const fs = await import("node:fs");
  const form = fs.readFileSync(new URL("../dashboard/src/components/TenantForm.tsx", import.meta.url), "utf8");
  const places = fs.readFileSync(new URL("../dashboard/src/components/structured/PlacesEditor.tsx", import.meta.url), "utf8");
  assert.match(places, /place-hours/);
  // #964 dropped the "no premises" switch from TenantForm (open design question, see PR). The settings save keeps
  // the stored flag so a business without premises is still described that way.
  assert.doesNotMatch(form, /noPremises|no_premises/);
  const actions = fs.readFileSync(new URL("../dashboard/src/app/(desk)/settings/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /formatLocationsForCompiler\(businessLocations, \{ noPremises \}\)/);
});
