import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { adminV2FlagOn } from "../dashboard/src/lib/adminV2.ts";

test("ADMIN_V2: on, true, 1, yes (any case, trimmed) are on; anything else is off", () => {
  for (const v of ["on", "ON", " on ", "true", "True", "1", "yes"]) assert.equal(adminV2FlagOn(v), true, v);
  for (const v of [undefined, null, "", "off", "0", "false", "no", "alvin", "alvin,mercy", "onn"]) assert.equal(adminV2FlagOn(v), false, String(v));
});

test("ADMIN_V2 is read in one place only", () => {
  const out = execFileSync("git", ["grep", "-l", "process.env.ADMIN_V2", "--", "dashboard/src"], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(out, ["dashboard/src/lib/adminV2.ts"]);
  const layout = readFileSync(new URL("../dashboard/src/app/admin/(console)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /v2=\{isAdminV2Enabled\(\)\}/);
  assert.match(layout, /showAccessRequests=\{isAdminV2Enabled\(\)\}/);
});
