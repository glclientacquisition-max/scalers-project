// Landing P0-1 (30 Oct): pricing from billing_packages, Beta program featured, plan carried into Request access.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { accessPlanFromParam, withPlanPrefix, BETA_PROGRAM } from "../dashboard/src/lib/accessPlan.ts";
import { parseAccessRequestForm } from "../dashboard/src/lib/accessRequestLogic.ts";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "dashboard/src", p), "utf8");

test("plan param is cleaned; unknown shapes are dropped", () => {
  assert.equal(accessPlanFromParam("Beta"), "beta");
  assert.equal(accessPlanFromParam(["growth", "x"]), "growth");
  assert.equal(accessPlanFromParam("<script>"), null);
  assert.equal(accessPlanFromParam(undefined), null);
  assert.equal(withPlanPrefix("We clean homes", "beta"), "[Plan: Beta program] We clean homes");
  assert.equal(withPlanPrefix("We clean homes", null), "We clean homes");
});

test("Request access stores the picked plan at the front of about", () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "Jane", business_name: "Jirani", email: "j@x.co", phone: "0712345678", about: "Cleaning", plan: "starter" })) fd.set(k, v);
  const r = parseAccessRequestForm(fd);
  assert.ok(r.ok);
  assert.equal(r.ok && r.fields.about, "[Plan: Starter] Cleaning");
});

test("Beta is featured and picked first; no free, no trial, no hard-coded price", () => {
  const ui = read("components/marketing/PackagePrices.tsx");
  assert.match(ui, /useState<string>\(BETA_PLAN\)/);
  assert.match(ui, /featured>/);
  assert.match(ui, /href=\{`\/signup\?plan=\$\{encodeURIComponent\(picked\)\}`\}/);
  const copy = JSON.stringify(BETA_PROGRAM) + ui + read("app/pricing/page.tsx");
  assert.doesNotMatch(copy, /\bfree\b|\btrial\b|coming soon/i);
  assert.doesNotMatch(ui, /KES \d|KSh \d|\d{1,3},\d{3}/);
  assert.match(read("app/signup/page.tsx"), /<RequestAccessForm plan=\{plan\} \/>/);
  assert.match(read("app/signup/page.tsx"), /<PlanRequestForm searchParams=\{searchParams\} \/>/);
});
