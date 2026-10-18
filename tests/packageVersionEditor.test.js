const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { promoteTargetRefusal, PROD_PROJECT_REF } = require("../scripts/promote-package-version");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const editor = read("dashboard/src/lib/packageVersionEditor.ts");
const route = read("dashboard/src/app/api/admin/package-versions/route.ts");

describe("package version editor", () => {
  it("refuses a caller who is not a Super Admin before any database call", () => {
    const get = route.indexOf("export async function GET");
    const getGate = route.indexOf('error: "ops_only"', get);
    const list = route.indexOf("admin_list_package_versions", get);
    const post = route.indexOf("export async function POST");
    const postGate = route.indexOf('error: "ops_only"', post);
    const write = route.indexOf("runEditorCommand(actor", post);
    assert.ok(get > 0 && post > get);
    assert.ok(getGate > get && list > getGate);
    assert.ok(postGate > post && write > postGate);
    assert.match(route, /isLegacyAuthenticated\(\)/);
    assert.match(route, /status: 403/);
    assert.doesNotMatch(route, /body\.actor/);
    assert.match(route, /adminActorName\(\)/);
  });

  it("keeps production writes off unless the editor flag is on", () => {
    assert.match(editor, /fjxcdccgyhnvnnlnovcl/);
    assert.match(editor, /ADMIN_PACKAGE_EDITOR_ALLOW_PROD === "on"/);
    assert.match(route, /package_editor_staging_only/);
    assert.match(route, /packageEditorWritesAllowed\(\)/);
  });

  it("does not run the promote script against production", () => {
    const script = read("scripts/promote-package-version.js");
    assert.equal(PROD_PROJECT_REF, "fjxcdccgyhnvnnlnovcl");
    assert.match(script, /needs Alvin's go/);
    assert.equal(
      promoteTargetRefusal("https://fjxcdccgyhnvnnlnovcl.supabase.co", {}),
      "This script does not run against production. Promoting a package version there needs Alvin's go. This run does not do that.",
    );
    assert.equal(promoteTargetRefusal("https://sgcdncjxauhsbunobmob.supabase.co", {}), null);
    assert.equal(
      promoteTargetRefusal("https://fjxcdccgyhnvnnlnovcl.supabase.co", {
        PACKAGE_VERSION_PROMOTE_ALLOW_PROD: "yes",
      }),
      null,
    );
    assert.doesNotMatch(script, /sk_live|service_role_key\s*=\s*['"]ey/);
  });
});

describe("package version editor commands", () => {
  it("loads the pure checks", async () => {
    const mod = await import("../dashboard/src/lib/packageVersionEditor.ts");
    assert.equal(typeof mod.parseEditorCommand, "function");
  });

  it("rejects a negative allowance and a missing reason", async () => {
    const mod = await import("../dashboard/src/lib/packageVersionEditor.ts");
    const missing = mod.parseEditorCommand({ action: "draft", sku: "starter" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /reason/i);
    const negative = mod.parseEditorCommand({
      action: "update_draft",
      version_id: "11111111-1111-1111-1111-111111111111",
      reason: "fixture",
      patch: {
        monthly_price_kes: 1111,
        seats: 2,
        minutes: -1,
        message_credits: 111,
        sms_credit_burn: 1,
        whatsapp_credit_burn: 2,
        email_credit_burn: 1,
        dids: 1,
        inbound_kes_per_second: 0,
        outbound_kes_per_second: 0,
        annual_discount_percent: 0,
        trial_days: null,
        allowances_placeholder: false,
        on_demand_allowed: true,
        features: [{ key: "calls", enabled: true }],
      },
      actor: "forged",
    });
    assert.equal(negative.ok, false);
    assert.match(negative.error, /zero or more/i);
    const pool = mod.parseEditorCommand({
      action: "update_draft",
      version_id: "11111111-1111-1111-1111-111111111111",
      reason: "fixture pool",
      patch: {
        monthly_price_kes: 1111,
        seats: 2,
        minutes: 20,
        message_credits: 111,
        sms_credit_burn: 1,
        whatsapp_credit_burn: 2,
        email_credit_burn: 1,
        dids: 1,
        inbound_kes_per_second: 0.1,
        outbound_kes_per_second: 0.15,
        annual_discount_percent: 17,
        trial_days: null,
        allowances_placeholder: true,
        on_demand_allowed: false,
        features: [{ key: "calls", enabled: true }],
      },
    });
    assert.equal(pool.ok, true);
    assert.equal(pool.command.patch.message_credits, 111);
    assert.equal(pool.command.patch.on_demand_allowed, false);
    assert.equal(pool.command.patch.sms_credit_burn, 1);
    assert.equal("sms" in pool.command.patch, false);
    assert.equal("sms_kes" in pool.command.patch, false);
  });

  it("keeps the actor out of the parsed command", async () => {
    const mod = await import("../dashboard/src/lib/packageVersionEditor.ts");
    const parsed = mod.parseEditorCommand({
      action: "draft",
      sku: "trial",
      reason: "open the trial draft",
      actor: "forged",
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command.action, "draft");
    assert.equal(parsed.command.sku, "trial");
    assert.equal("actor" in parsed.command, false);
  });

  it("maps a price-change refusal to approval_required", async () => {
    const mod = await import("../dashboard/src/lib/packageVersionEditor.ts");
    assert.deepEqual(mod.packageVersionEditorHttpStatus("price change needs a second admin"), {
      status: 409,
      error: "approval_required",
    });
    assert.deepEqual(mod.packageVersionEditorHttpStatus("message credits are required"), {
      status: 400,
      error: "invalid",
    });
    assert.deepEqual(mod.packageVersionEditorHttpStatus("on-demand setting is required"), {
      status: 400,
      error: "invalid",
    });
    assert.deepEqual(
      mod.packageVersionEditorHttpStatus("a beta business is not moved onto a package version"),
      { status: 400, error: "invalid" },
    );
    const sql = read("docs/supabase/package_version_editor.sql");
    assert.match(sql, /message credits are required/);
    assert.match(sql, /a beta business is not moved onto a package version/);
    assert.match(sql, /confirm the move/);
    assert.match(sql, /system_move_subscribers_to_package_version/);
    assert.match(sql, /admin_set_tenant_billing_mode/);
    assert.match(sql, /a package change keeps the current version/);
    assert.match(sql, /new_signup_trial_enabled boolean not null default false/);
    assert.match(sql, /tenants_a_new_signup_trial/);
    assert.doesNotMatch(sql, /insert into public\.invoices/i);
    const move = mod.parseEditorCommand({
      action: "move_subscribers",
      version_id: "11111111-1111-1111-1111-111111111111",
      tenant_ids: ["22222222-2222-2222-2222-222222222222"],
      reason: "move a beta business",
    });
    assert.equal(move.ok, false);
    const confirmed = mod.parseEditorCommand({
      action: "move_subscribers",
      version_id: "11111111-1111-1111-1111-111111111111",
      tenant_ids: ["22222222-2222-2222-2222-222222222222"],
      reason: "move a beta business",
      confirm: true,
    });
    assert.equal(confirmed.ok, true);
    if (confirmed.ok && confirmed.command.action === "move_subscribers") {
      assert.equal(confirmed.command.confirm, true);
    }
    assert.match(sql, /sms_kes = v_sms_burn/);
    assert.match(sql, /message_credits stays null/);
    assert.equal(mod.packageEditorWritesAllowed({
      SUPABASE_URL: "https://fjxcdccgyhnvnnlnovcl.supabase.co",
    }), false);
    assert.equal(mod.packageEditorWritesAllowed({
      NEXT_PUBLIC_SUPABASE_URL: "https://sgcdncjxauhsbunobmob.supabase.co",
    }), true);
  });
});
