"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const copyPath = path.join(ROOT, "dashboard/src/lib/adminPayCopy.ts");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function load(body) {
  const stamped = path.join(os.tmpdir(), "admin-pay-copy-fc49.ts");
  const activity = path.join(ROOT, "dashboard/src/lib/adminActivityModel.ts");
  const src = fs
    .readFileSync(copyPath, "utf8")
    .replace('from "./adminActivityModel"', `from ${JSON.stringify(activity)}`);
  fs.writeFileSync(stamped, src);
  const script = `
    import {
      allowlistCount,
      bachsStatusFromEnv,
      kshLabel,
      reconcileCounts,
      reviewReasonFromRaw,
      reviewTitle,
    } from ${JSON.stringify(stamped)};
    const out = ${body};
    console.log(JSON.stringify(out));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("admin pay queue labels", () => {
  it("names checkout review reasons and keeps money as KSh", () => {
    const got = load(`({
      missing: reviewTitle(reviewReasonFromRaw({ review_kind: "missing_identity" })),
      down: reviewTitle(reviewReasonFromRaw({ review_kind: "decrease" })),
      short: reviewTitle(reviewReasonFromRaw({ reason: "collected_total_short" })),
      money: kshLabel("1400"),
    })`);
    assert.equal(got.missing, "Collected amount has no receipt");
    assert.equal(got.down, "Collected total went down");
    assert.equal(got.short, "Collected total is short");
    assert.equal(got.money, "KSh 1,400");
  });

  it("reports Bachs as on or off and never echoes a secret", () => {
    const secret = "sk_live_should_not_appear";
    const got = load(`bachsStatusFromEnv({
      mode: "live",
      liveAllowed: "true",
      key: ${JSON.stringify(secret)},
      webhookSecret: "whsec_should_not_appear",
    })`);
    assert.equal(got.mode, "live");
    assert.equal(got.liveSwitch, "On");
    assert.equal(got.keySet, "Yes");
    assert.equal(got.webhookSecretSet, "Yes");
    assert.equal(JSON.stringify(got).includes(secret), false);
    assert.equal(JSON.stringify(got).includes("whsec_should_not_appear"), false);
    const off = load(`bachsStatusFromEnv({ mode: "mock", liveAllowed: "false", apiKey: "", webhookSecret: "" })`);
    assert.equal(off.mode, "off");
    assert.equal(off.liveSwitch, "Off");
    assert.equal(off.keySet, "No");
  });

  it("counts an environment list without returning the ids", () => {
    const got = load(`({
      all: allowlistCount("*"),
      none: allowlistCount("  "),
      two: allowlistCount("a, b"),
      recon: reconcileCounts([{ kind: "pending_timeout" }, { kind: "pending_timeout" }, { kind: "issue" }]),
    })`);
    assert.deepEqual(got.all, { all: true, count: 0 });
    assert.deepEqual(got.none, { all: false, count: 0 });
    assert.deepEqual(got.two, { all: false, count: 2 });
    assert.deepEqual(got.recon, [
      { label: "Pending too long", count: 2 },
      { label: "Needs a check", count: 1 },
    ]);
  });

  it("keeps secret reads on the server page, not in client billing UI", () => {
    const server = read("dashboard/src/lib/adminPayRead.ts");
    assert.match(server, /process\.env\.BACHS_MODE/);
    assert.match(server, /billing_live_tenants/);
    assert.match(server, /billing_payment_reconciliation/);
    assert.doesNotMatch(server, /payProviderFromEnv/);
    for (const rel of [
      "dashboard/src/lib/adminBilling.ts",
      "dashboard/src/components/AdminBillingListPanel.tsx",
      "dashboard/src/components/AdminShopMoneyPanel.tsx",
      "dashboard/src/components/CheckoutReviewResolve.tsx",
      "dashboard/src/components/AdminInvoiceList.tsx",
      "dashboard/src/components/AdminPaymentsStatus.tsx",
      "dashboard/src/lib/adminPayCopy.ts",
    ]) {
      assert.doesNotMatch(read(rel), /adminPayRead|BACHS_|process\.env/, rel);
    }
    const status = read("dashboard/src/components/AdminPaymentsStatus.tsx");
    assert.match(status, /Webhook secret/);
    assert.doesNotMatch(status, /API key|api key/i);
  });
});
