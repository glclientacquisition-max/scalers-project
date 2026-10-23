const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("s22b: destructive confirm uses solid dangerSolid, readable disabled state, says why", () => {
  const btn = read("dashboard/src/components/ui/Button.tsx");
  assert.match(btn, /dangerSolid:/);
  assert.match(btn, /disabled:bg-surface-2/);
  const c = read("dashboard/src/components/ops/OpsConfirm.tsx");
  assert.match(c, /"dangerSolid"/);
  assert.match(c, /data-blocked-why/);
  assert.match(c, /Add a reason to continue\./);
  assert.match(c, /data-consequence/);
  assert.doesNotMatch(c, /Dialog|framer-motion/);
});
