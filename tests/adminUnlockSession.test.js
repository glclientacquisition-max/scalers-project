const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("Unlock session hook reads GET /api/admin/step-up and listens for unlock events", () => {
  const hook = read("dashboard/src/components/ops/useAdminUnlockSession.ts");
  assert.match(hook, /\/api\/admin\/step-up/);
  assert.match(hook, /unlockTimeLeft/);
  assert.match(hook, /STEP_UP_UNLOCKED_EVENT/);
  const sheet = read("dashboard/src/components/ops/StepUpSheet.tsx");
  assert.match(sheet, /STEP_UP_UNLOCKED_EVENT/);
  const cta = read("dashboard/src/components/ops/UnlockCta.tsx");
  assert.match(cta, /useAdminUnlockSession/);
  assert.match(cta, /Unlocked ·/);
});

test("Packages v2 paginates with ?page= and archives instead of delete", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminPackagesV2.tsx");
  assert.match(ui, /PAGE_SIZE = 25/);
  assert.match(ui, /searchParams\.get\("page"/);
  assert.match(ui, /data-packages-pagination/);
  assert.match(ui, /action: "archive"/);
  assert.match(ui, /OpsConfirm/);
  assert.doesNotMatch(ui, /action: "delete"/);
});

test("access request server actions use operator write gate", () => {
  const actions = read("dashboard/src/app/admin/(console)/access-requests/actions.ts");
  assert.match(actions, /requireAdminOperatorWrite/);
  assert.doesNotMatch(actions, /\|\| "ops"/);
});
