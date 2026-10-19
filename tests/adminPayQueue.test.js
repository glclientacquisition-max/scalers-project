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
      hostingSwitches,
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

  it("reads hosting switches without echoing secrets or env names", () => {
    const got = load(`hostingSwitches({
      mode: "sandbox",
      liveAllowed: "true",
      noticesSend: "ON",
      planChange: "on",
    })`);
    assert.deepEqual(got, { modeOn: true, liveMasterOn: true, noticesOn: true, planChangeOn: true });
    const locked = load(`hostingSwitches({ mode: "mock", liveAllowed: "yes", noticesSend: "true", planChange: "true" })`);
    assert.deepEqual(locked, { modeOn: false, liveMasterOn: false, noticesOn: false, planChangeOn: false });
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
    assert.match(status, /Changed in hosting settings/);
    assert.match(status, /Package editor/);
    assert.match(status, /Signup trial/);
    assert.match(status, /All live payments/);
    assert.doesNotMatch(status, /API key|api key/i);
    assert.doesNotMatch(status, /BILLING_NOTICES_SEND|DESK_PLAN_CHANGE|BACHS_/);
    const money = read("dashboard/src/components/AdminShopMoneyPanel.tsx");
    assert.match(money, /Live payments stay off while this business is on beta/);
    assert.match(money, /\/api\/billing\/live-tenants/);
    assert.match(money, /confirm: true/);
    assert.match(money, /label="Charging"/);
    assert.match(money, /checked=\{chargingOn\}/);
    const flags = read("dashboard/src/app/api/admin/billing/flags/route.ts");
    assert.match(flags, /requireSuperAdmin/);
    assert.match(flags, /packageEditorWritesAllowed/);
    assert.match(flags, /admin_set_package_editor_enabled/);
    assert.match(flags, /admin_set_new_signup_trial/);
    assert.match(flags, /adminActorName\(\)/);
    assert.doesNotMatch(flags, /body\.actor|posted\.actor/);
    const sql = read("docs/supabase/billing_package_editor_flag.sql");
    const body = sql.slice(sql.indexOf("as $$"), sql.indexOf("$$;"));
    assert.match(body, /_package_editor_actor/);
    assert.match(body, /set_package_editor_enabled/);
    assert.match(body, /_billing_audit/);
    assert.doesNotMatch(body, /_package_editor_open/);
    assert.match(sql, /grant execute on function public\.admin_set_package_editor_enabled\(boolean, text, text, boolean\) to service_role/);
    assert.match(sql, /from public, anon, authenticated/);
    const toggle = read("dashboard/src/components/ui/Switch.tsx");
    assert.match(toggle, /checked \? "bg-accent"/);
    assert.doesNotMatch(toggle, /checked && !disabled \? "bg-accent"/);
  });
});
