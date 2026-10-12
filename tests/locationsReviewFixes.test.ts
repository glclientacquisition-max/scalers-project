import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const sa = () => import("../dashboard/src/lib/serviceAreas.ts");
const bl = () => import("../dashboard/src/lib/businessLocations.ts");
const ca = () => import("../dashboard/src/lib/coverageAreas.ts");
const hs = () => import("../dashboard/src/lib/hoursSchedule.ts");

// Root cause of "Could not save.": tenants uses column-level UPDATE grants. The settings
// save writes service_areas, which the signed-in owner (role authenticated) could not
// update, so Postgres rejected the whole update with "permission denied for table tenants".
test("blocker: owners can update service_areas (column grant)", () => {
  const sql = read("../supabase/migrations/20261012150000_locations_service_areas.sql");
  assert.match(sql, /grant update \(service_areas\) on public\.tenants to authenticated/i);
  const actions = read("../dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(actions, /service_areas: formAreas/, "the settings save writes service_areas");
});

test("areas and places save straight away from their drawers", () => {
  const form = read("../dashboard/src/components/TenantForm.tsx");
  assert.match(form, /saveAfterLocationsRef/);
  assert.match(form, /onSave=\{/);
  const ed = read("../dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(ed, /onSave\(/);
});

test("change fee: own drawer, only existing areas, current fee prefilled", async () => {
  const m = await sa();
  let v = m.applyFeeToAreas(m.emptyServiceAreas("retail"), ["place:ruaka", "place:kitengela"], { fee_mode: "fixed", fee_ksh: 300, eta: "Next day" }, "retail");
  assert.deepEqual(m.commonFee(v.areas), { fee_mode: "fixed", fee_ksh: 300, eta: "Next day" });
  v = m.applyFeeToAreas(v, ["place:ruaka"], { fee_mode: "free", fee_ksh: null, eta: null }, "retail");
  assert.equal(m.commonFee(v.areas).fee_mode, "free", "first area's fee when they differ");
  const ed = read("../dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(ed, /title="Change fee"/);
});

test("legacy place: area chip from old text, no duplicate street/landmark, summary includes street", async () => {
  const l = await bl();
  const [p] = l.normalizeBusinessLocations([{ label: "Main", address: "Kenyatta Avenue, Nairobi CBD", landmark: "Kenyatta Avenue, Nairobi CBD" }]);
  const up = l.upgradeLegacyPlace(p);
  assert.equal(up.area_id, "place:nairobi cbd");
  assert.equal(up.address, "Kenyatta Avenue");
  assert.equal(up.landmark, "");
  assert.equal(l.placeSummary(up), "Nairobi CBD, Nairobi · Kenyatta Avenue");
  const dup = l.placeSummary({ ...up, landmark: "kenyatta avenue" });
  assert.equal(dup, "Nairobi CBD, Nairobi · Kenyatta Avenue");
});

test("hours line is human and never leaks Location:", async () => {
  const h = await hs();
  const s = { ...h.defaultHoursSchedule("Kenyatta Avenue"), location: "Kenyatta Avenue" };
  const line = h.formatHoursForOwner(s);
  assert.doesNotMatch(line, /Location|EAT/);
  assert.match(line, /Mon/);
});

test("directory search: counties labelled, no doubled names", async () => {
  const c = await ca();
  const k = c.searchAreaOptions("kiambu", [], 10);
  assert.ok(k.some((o) => o.id === "county:kiambu" && o.label === "Kiambu County"));
  assert.ok(k.every((o) => !/\b(\w+) \1\b/i.test(o.label)), k.map((o) => o.label).join(" | "));
  const r = c.searchAreaOptions("ruaka", [], 3);
  assert.equal(r[0].label, "Ruaka, Kiambu");
  assert.equal(r[0].hint, "Estate or town");
});

test("no silent auto-tick: home area is a visible suggestion", () => {
  const ed = read("../dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.doesNotMatch(ed, /openBulk\(homeAreas\)/);
  assert.match(ed, /Suggested/);
});

test("callers hear: areas with the same fee are grouped", async () => {
  const m = await sa();
  let v = m.applyFeeToAreas(m.emptyServiceAreas("retail"), ["place:ruaka", "place:kitengela"], { fee_mode: "fixed", fee_ksh: 200, eta: null }, "retail");
  v = m.applyFeeToAreas(v, ["county:nairobi"], { fee_mode: "free", fee_ksh: null, eta: null }, "retail");
  assert.equal(m.serviceAreasSentence(v), "We deliver to Ruaka and Kitengela for KSh 200. We deliver to Nairobi for free.");
});

test("hidden sections are explained; short phone placeholders; stronger helper text", () => {
  const ed = read("../dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(ed, /We come to you.*shows when you pick/s);
  const pl = read("../dashboard/src/components/structured/PlacesEditor.tsx");
  for (const m of pl.matchAll(/placeholder="([^"]+)"/g)) assert.ok(m[1].length <= 28, `placeholder too long for phones: ${m[1]}`);
  assert.doesNotMatch(pl + ed, /text-ink-3/);
});
