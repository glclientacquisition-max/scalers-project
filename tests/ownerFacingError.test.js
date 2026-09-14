"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/ownerFacingError.ts");

function loadHelper() {
  const script = `
    import { ownerFacingError } from ${JSON.stringify(helperPath)};
    const cases = [
      ["Could not save contact.", "Could not save."],
      ["relation service_requests does not exist Apply docs/supabase/contacts_and_requests.sql in Supabase.", "Could not save."],
      ["new row violates row-level security policy", "Could not save."],
      ["Set a time.", "Could not save."],
    ];
    console.log(JSON.stringify(cases.map(([raw, fallback]) => ownerFacingError(raw, fallback))));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

test("ownerFacingError keeps operational copy and strips SQL internals", () => {
  const results = loadHelper();
  assert.deepEqual(results, [
    "Could not save contact.",
    "Could not save.",
    "Could not save.",
    "Set a time.",
  ]);
});
