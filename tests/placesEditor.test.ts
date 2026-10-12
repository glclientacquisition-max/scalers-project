import test from "node:test";
import assert from "node:assert/strict";

const locs = () => import("../dashboard/src/lib/businessLocations.ts");

test("area comes from the directory; unknown ids are dropped", async () => {
  const l = await locs();
  const [a, b] = l.normalizeBusinessLocations([
    { label: "CBD", area_id: "county:nairobi", address: "Kimathi St" },
    { label: "X", area_id: "place:nowhereville" },
  ]);
  assert.equal(a.area_id, "county:nairobi");
  assert.equal(b.area_id, "");
});

test("prompt: area label, street, hours default to business hours", async () => {
  const l = await locs();
  const rows = l.normalizeBusinessLocations([{ label: "CBD", area_id: "county:nairobi", address: "Kimathi St", landmark: "Opposite Hilton" }]);
  const p = l.formatLocationsForCompiler(rows);
  assert.match(p, /Area: Nairobi/);
  assert.match(p, /Street: Kimathi St/);
  assert.doesNotMatch(p, /Hours:/, "no override means the business hours apply");
});

test("place summary for the list row", async () => {
  const l = await locs();
  const [r] = l.normalizeBusinessLocations([{ label: "CBD", area_id: "county:nairobi", landmark: "Opposite Hilton", hours: "Daily 9-9" }]);
  assert.equal(l.placeSummary(r), "Nairobi · Opposite Hilton · Own hours");
  const [s] = l.normalizeBusinessLocations([{ label: "Main", address: "Moi Ave" }]);
  assert.equal(l.placeSummary(s), "Moi Ave");
});

test("validatePlace needs a name or an area", async () => {
  const l = await locs();
  assert.ok(l.validatePlace({ ...l.emptyLocation() }).label);
  assert.deepEqual(l.validatePlace({ ...l.emptyLocation(), label: "CBD" }), {});
});

test("UI: places use kit fields in a Sheet with the area picker and hours toggle", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../dashboard/src/components/structured/PlacesEditor.tsx", import.meta.url), "utf8");
  for (const s of ["<Sheet", "TextField", "TextAreaField", "searchCoverageAreas", "<Switch", "Same as business hours", "Opposite Hilton, Kimathi St"]) {
    assert.ok(src.includes(s), s);
  }
  const form = fs.readFileSync(new URL("../dashboard/src/components/TenantForm.tsx", import.meta.url), "utf8");
  assert.match(form, /<PlacesEditor/);
  assert.doesNotMatch(form, /id=\{`loc-label-\$\{index\}`\}/);
});
