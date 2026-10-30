// Every billing test file must run in CI. A file that no script names never runs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const scripts = [
  readFileSync("package.json", "utf8"),
  readFileSync("dashboard/package.json", "utf8"),
  ...readdirSync(".github/workflows").map((f) => readFileSync(`.github/workflows/${f}`, "utf8")),
].join("\n");

describe("billing tests are wired into CI", () => {
  it("names every billing, package, wallet, invoice and grant test in a script", () => {
    const billing = readdirSync("tests").filter(
      (f) => /\.test\.(js|mjs|ts)$/.test(f) && /bill|package|wallet|invoice|grant/i.test(f),
    );
    assert.ok(billing.length > 20, `found only ${billing.length} billing tests`);
    const orphans = billing.filter((f) => !scripts.includes(`tests/${f}`));
    assert.deepEqual(orphans, [], `not run by any script: ${orphans.join(", ")}`);
  });
});
