import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as sa from "../dashboard/src/lib/serviceAreas.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261013090000_outside_areas.sql";
const nairobi = { id: "county:nairobi", modes: ["delivery"], fee_mode: "free", eta: "Same day", source: "owner", confirmed: true };

test("default is No; Yes keeps a whole KSh fee or blank", () => {
  assert.equal(sa.emptyServiceAreas("retail").anywhere_kenya, false);
  const v = sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true, outside_fee_ksh: "1,200" }, "retail");
  assert.equal(v.anywhere_kenya, true);
  assert.equal(v.outside_fee_ksh, 1200);
  assert.equal(sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true, outside_fee_ksh: "" }).outside_fee_ksh, null);
  // No clears the fee; walk-in only hides it
  assert.equal(sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: false, outside_fee_ksh: 500 }).outside_fee_ksh, null);
  const w = sa.withReach(sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true, outside_fee_ksh: 500 }), "walk_in");
  assert.equal(sa.coverageOutsideFrom(w), null);
});

test("mirror for the voice server", () => {
  const v = sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true, outside_fee_ksh: 350 });
  assert.deepEqual(sa.coverageOutsideFrom(v), { anywhere_kenya: true, fee_ksh: 350 });
  assert.equal(sa.coverageOutsideFrom(sa.normalizeServiceAreas({ areas: [nairobi] })), null);
});

test("callers hear and the prompt", () => {
  const v = sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true, outside_fee_ksh: 350 }, "retail");
  assert.equal(sa.serviceAreasSentence(v), "We deliver to Nairobi for free, same day. Anywhere else in Kenya, delivery is KSh 350.");
  const q = sa.normalizeServiceAreas({ areas: [nairobi], anywhere_kenya: true }, "retail");
  assert.match(sa.serviceAreasSentence(q), /Anywhere else in Kenya, the team calls back with the fee\.$/);
  const h = sa.normalizeServiceAreas({ areas: [{ ...nairobi, modes: ["visit"] }], reach: "visit", anywhere_kenya: true, outside_fee_ksh: 900 }, "home_services");
  assert.match(sa.serviceAreasSentence(h), /Anywhere else in Kenya, the team calls back with the travel price\.$/);
  const p = sa.formatServiceAreasForCompiler(v);
  assert.match(p, /Anywhere else in Kenya: delivery, KSh 350/);
  assert.doesNotMatch(p, /A place not on this list is not covered/);
  assert.match(p, /Outside Kenya is not covered/);
  assert.match(sa.formatServiceAreasForCompiler(h), /never book a time/i);
  assert.match(sa.formatServiceAreasForCompiler(sa.normalizeServiceAreas({ areas: [nairobi] })), /A place not on this list is not covered/);
});

test("editor: question under the list, hidden for walk-in, fee optional", () => {
  const src = read("dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(src, /Do you go outside these areas\?/);
  assert.match(src, /Yes, anywhere in Kenya/);
  assert.match(src, /outsideFeeHint/);
  assert.match(src, /copy\.areas/);
});

test("save path mirrors coverage_outside", () => {
  assert.match(read("dashboard/src/app/(desk)/settings/actions.ts"), /coverage_outside: coverageOutsideFrom\(serviceAreas\)/);
});

test("migration is additive and checks the new keys", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create or replace function public\.service_areas_valid/);
  assert.match(sql, /anywhere_kenya/);
  assert.match(sql, /outside_fee_ksh/);
  assert.doesNotMatch(sql, /\bdrop table\b|\bdelete from\b|\bupdate public\./i);
});

test("one outside answer survives every mode toggle, walk-in included", () => {
  let v = sa.normalizeServiceAreas({ areas: [nairobi], reach: "deliver", anywhere_kenya: true, outside_fee_ksh: 350 }, "retail");
  for (const r of ["visit", "both", "walk_in", "deliver"] as const) v = sa.withReach(v, r);
  assert.equal(v.anywhere_kenya, true);
  assert.equal(v.outside_fee_ksh, 350);
  // walk-in still says nothing to callers or the voice server
  const w = sa.withReach(v, "walk_in");
  assert.equal(sa.coverageOutsideFrom(w), null);
  assert.doesNotMatch(sa.serviceAreasSentence(w), /Kenya/);
  // stored through a save in visit mode, the fee comes back in deliver mode
  const saved = sa.normalizeServiceAreas(JSON.parse(JSON.stringify(sa.withReach(v, "visit"))), "retail");
  assert.equal(sa.withReach(saved, "deliver").outside_fee_ksh, 350);
});

test("fee hint says what callers hear, or the quote hint when blank", () => {
  assert.equal(sa.outsideFeeHint(350), "Callers outside your areas hear: delivery there is KSh 350.");
  assert.equal(sa.outsideFeeHint(null), "Leave blank and the team quotes it on a callback.");
  const src = read("dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(src, /hint=\{outsideFeeHint\(value\.outside_fee_ksh\)\}/);
  assert.match(src, /useEffect\(\(\) => \{\s*setOutsideFee/);
});

test("a successful save clears unsaved changes, Locations included", () => {
  const src = read("dashboard/src/components/TenantForm.tsx");
  assert.match(src, /serviceAreasJson,\n/);
  assert.match(src, /savedBaseline\(/);
  const { savedBaseline } = sa;
  assert.equal(savedBaseline({ ok: true }, "k2", "k1"), "k2");
  assert.equal(savedBaseline({ ok: false }, "k2", "k1"), "k1");
});
