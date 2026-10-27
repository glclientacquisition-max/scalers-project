// "We come to you" (no premises) switch on Business Settings › Locations, next to Service areas.
// #964 (43d9870b) removed it with ServiceAreasEditor. Same stored key as before: tenants.service_areas.no_premises.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const sa = () => import("../dashboard/src/lib/serviceAreas.ts");
const scope = () => import("../dashboard/src/lib/settingsSaveScope.ts");
const bl = () => import("../dashboard/src/lib/businessLocations.ts");

test("render: Locations shows the switch above the places, wired to the form and the unsaved state", () => {
  const form = read("../dashboard/src/components/TenantForm.tsx");
  const locations = form.slice(form.indexOf('className={panel === "locations"'), form.indexOf('className={panel === "policies"'));
  assert.match(locations, /<SettingsGroup title="Your premises">/);
  assert.match(locations, /data-no-premises=""/);
  assert.match(locations, /<SettingsRow\s+label="We come to you"\s+control="switch"/);
  assert.match(locations, /<ToolSwitch checked=\{noPremises\} label="We come to you" onChange=\{setNoPremises\} \/>/);
  assert.ok(locations.indexOf("data-no-premises") < locations.indexOf("<PlacesEditor"), "switch sits above the places");
  assert.match(locations, /noPremises \? "Your base \(optional\)"/);
  assert.match(locations, /For reference only\. Callers are not sent here\./);
  assert.match(form, /useState\(\(\) => storedNoPremises\(tenant\.service_areas\)\)/);
  assert.match(form, /<input type="hidden" name="no_premises" value=\{noPremises \? "1" : "0"\} \/>/);
  const draft = form.slice(form.indexOf("const draftValues = ["), form.indexOf("useFormDraft(save"));
  assert.match(draft, /noPremises \? "1" : "0"/, "a flip shows Save");
  const copy = locations.slice(locations.indexOf("Your premises"), locations.indexOf("<PlacesEditor"));
  assert.doesNotMatch(copy, /[\u2013\u2014]|tenant|shop\b(?! or office)/i);
  assert.doesNotMatch(copy, /#[0-9a-f]{3,6}\b/i, "tokens only");
  const nav = read("../dashboard/src/lib/businessSettingsNav.ts");
  assert.ok(nav.indexOf('label: "Locations"') < nav.indexOf('label: "Service areas"'), "Locations sits next to Service areas");
});

test("save: Locations owns the key; the action writes only no_premises into service_areas", async () => {
  const s = await scope();
  assert.equal(s.settingsFieldFromScope("locations", "noPremises", true, false), true);
  for (const other of ["identity", "hours", "policies", "catalog", "tools", "team", "faqs"]) {
    assert.equal(s.settingsFieldFromScope(other, "noPremises", true, false), false, `${other} keeps the stored value`);
  }
  const actions = read("../dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(actions, /settingsFieldFromScope\(scope, "noPremises", true, false\) && premisesField != null/);
  assert.match(actions, /!formAreas && noPremises !== storedPremisesFlag\s*\? serviceAreasWithNoPremises\(/);
  assert.match(actions, /premisesAreas \? \{ service_areas: premisesAreas \}/);
  assert.match(actions, /formatLocationsForCompiler\(businessLocations, \{ noPremises \}\)/);
});

test("save round trip: on, read back, compiled, off again; other keys untouched", async () => {
  const m = await sa();
  const l = await bl();
  const stored = {
    version: 1,
    areas: [{ id: "county:nairobi", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 200, eta: null, source: "owner", confirmed: true }],
    reach: "deliver",
    anywhere_kenya: true,
    outside_fee_ksh: 500,
    no_premises: false,
  };
  const on = m.serviceAreasWithNoPremises(stored, null, "retail", true);
  assert.deepEqual(on, { ...stored, no_premises: true });
  const back = JSON.parse(JSON.stringify(on));
  assert.equal(m.storedNoPremises(back), true);
  const norm = m.normalizeServiceAreas(back, "retail");
  assert.equal(norm.no_premises, true, "holds for a business that delivers too");
  assert.equal(norm.areas[0].fee_ksh, 200);
  assert.match(l.formatLocationsForCompiler([], { noPremises: norm.no_premises }), /We come to you/);
  const off = m.serviceAreasWithNoPremises(back, null, "retail", false);
  assert.deepEqual(off, stored);
});

test("never saved before: starts from the old coverage list so the areas text does not change", async () => {
  const m = await sa();
  const v = m.serviceAreasWithNoPremises(null, ["county:nairobi"], "home_services", true);
  assert.equal(v.no_premises, true);
  const fromCoverage = m.serviceAreasFromCoverage(["county:nairobi"], "home_services");
  assert.equal(m.formatServiceAreasForCompiler(m.normalizeServiceAreas(v, "home_services")), m.formatServiceAreasForCompiler(fromCoverage));
  assert.deepEqual(m.serviceAreasWithNoPremises(undefined, null, "retail", false).areas, []);
});

test("preserved: a stored true survives reads, other panel saves and the area mirror", async () => {
  const m = await sa();
  for (const reach of ["deliver", "visit", "walk_in", "both"]) {
    assert.equal(m.normalizeServiceAreas({ areas: [], reach, no_premises: true }, "retail").no_premises, true, reach);
  }
  assert.equal(m.storedNoPremises({ no_premises: "true" }), false, "only a real boolean");
  assert.equal(m.storedNoPremises(null), false);
  const mirror = await import("../dashboard/src/lib/areaPicksToCoverageAreas.ts");
  const a = await import("../dashboard/src/lib/areaPicks.ts");
  const out = mirror.areaPicksToCoverageAreas(a.toggleArea(a.emptyAreaPicks(), "county:nairobi"));
  assert.equal(mirror.applyCoverageMirrorToServiceAreas({ no_premises: true, reach: "visit" }, out).no_premises, true);
});
