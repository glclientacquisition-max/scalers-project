const { test } = require("node:test");
const assert = require("node:assert/strict");

test("today's outcomes stay in the buckets the facts name", async () => {
  const { splitOutcomes, splitTotal } = await import("../dashboard/src/lib/todayOutcomes.ts");
  const split = splitOutcomes(["info_only", "callback", "abandoned", "lost", null, "booking"]);
  assert.deepEqual(split, { answered: 2, handed: 1, hung: 1, other: 1 });
  assert.equal(splitTotal(split), 5);
});
