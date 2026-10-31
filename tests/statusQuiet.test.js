const { test } = require("node:test");
const assert = require("node:assert/strict");

test("Live and Active are not pills", async () => {
  const { isDefaultStatus } = await import("../dashboard/src/lib/statusQuiet.ts");
  assert.equal(isDefaultStatus("Live"), true);
  assert.equal(isDefaultStatus("Active"), true);
  assert.equal(isDefaultStatus("Overdue"), false);
  assert.equal(isDefaultStatus("Needs training"), false);
});
