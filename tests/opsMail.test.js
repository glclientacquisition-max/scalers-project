"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const modelPath = path.join(ROOT, "dashboard/src/lib/platformOpsModel.ts");

function run(script) {
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("ops mail Resend records", () => {
  it("keeps MX priority and drops empty rows", () => {
    const got = run(`
      import { normalizeResendRecords, OPS_RESEND_DOMAIN } from ${JSON.stringify(modelPath)};
      const records = normalizeResendRecords([
        { type: "MX", name: "ops", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "not_started" },
        { type: "TXT", name: "ops", value: "v=spf1 include:amazonses.com ~all" },
        { type: "CNAME", name: "" },
        null,
      ]);
      console.log(JSON.stringify({ domain: OPS_RESEND_DOMAIN, records }));
    `);
    assert.equal(got.domain, "ops.scalers.co.ke");
    assert.equal(got.records.length, 2);
    assert.equal(got.records[0].type, "MX");
    assert.equal(got.records[0].priority, 10);
    assert.equal(got.records[1].type, "TXT");
    assert.equal(got.records[1].priority, null);
  });
});
