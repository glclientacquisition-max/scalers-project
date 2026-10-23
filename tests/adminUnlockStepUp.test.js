const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("s23: one StepUpSheet; Unlock never writes domain state; enforce never fakes success", () => {
  const sheet = read("dashboard/src/components/ops/StepUpSheet.tsx");
  assert.match(sheet, /\/api\/admin\/step-up/);
  assert.doesNotMatch(sheet, /did-pool|businesses|Dialog|framer-motion/);
  assert.match(sheet, /doesn&apos;t change anything by itself/);
  const route = read("dashboard/src/app/api/admin/step-up/route.ts");
  assert.match(route, /requireAdminOperatorWrite/);
  assert.match(route, /requireStepUp\(/);
  assert.match(route, /status: 501/);
  assert.doesNotMatch(route, /getSupabaseAdmin|verified: true/);
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /data-stepup="numbers"/);
  assert.match(ui, /<StepUpSheet/);
});
