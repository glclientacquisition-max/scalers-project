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
        annual_price_kes: 0,
        credit_kes: 1,
        spend_limit_share_percent: 50,
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
        annual_price_kes: 10000,
        credit_kes: 1,
        spend_limit_share_percent: 50,
        extra_seat_monthly_kes: null,
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
    assert.equal(pool.command.patch.annual_price_kes, 10000);
    assert.equal(pool.command.patch.credit_kes, 1);
    assert.equal(pool.command.patch.spend_limit_share_percent, 50);
    assert.equal(pool.command.patch.extra_seat_monthly_kes, null);
    assert.equal("annual_discount_percent" in pool.command.patch, false);
    assert.equal("sms" in pool.command.patch, false);
    assert.equal("sms_kes" in pool.command.patch, false);
    const panel = read("dashboard/src/components/AdminPackageVersionsPanel.tsx");
    assert.match(panel, /Annual price/);
    assert.match(panel, /Implied discount/);
    assert.match(panel, /Credit price/);
    assert.match(panel, /Spend limit %/);
    assert.match(panel, /Extra seat \(KSh \/ month\)/);
    assert.match(panel, /extraSeatSupported/);
    assert.match(panel, /Trial minutes/);
    assert.match(panel, /Trial credits/);
    assert.doesNotMatch(panel, /Annual discount %/);
    const sql = read("docs/supabase/package_version_editor.sql");
    assert.match(sql, /add column if not exists annual_price_kes numeric/);
    assert.match(sql, /credit_kes numeric not null default 1/);
    assert.match(sql, /spend_limit_share_percent numeric not null default 50/);
    assert.match(sql, /_package_version_has_column\('extra_seat_monthly_kes'\)/);
    assert.match(sql, /then 500/);
    assert.doesNotMatch(sql, /add column if not exists extra_seat_monthly_kes/);
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
    assert.match(
      sql,
      /if p_billing_status = 'beta' and p_enforcement is distinct from 'off' then\s+raise exception/,
    );
    const betaSoft = mod.parseEditorCommand({
      action: "set_billing_mode",
      tenant_id: "11111111-1111-1111-1111-111111111111",
      billing_status: "beta",
      enforcement: "soft",
      reason: "keep beta and charge",
      confirm: true,
    });
    assert.equal(betaSoft.ok, false);
    const activeOff = mod.parseEditorCommand({
      action: "set_billing_mode",
      tenant_id: "11111111-1111-1111-1111-111111111111",
      billing_status: "active",
      enforcement: "off",
      reason: "leave active with billing off",
      confirm: true,
    });
    assert.equal(activeOff.ok, false);
    const activeSoft = mod.parseEditorCommand({
      action: "set_billing_mode",
      tenant_id: "11111111-1111-1111-1111-111111111111",
      billing_status: "active",
      enforcement: "soft",
      reason: "turn billing on",
      confirm: true,
    });
    assert.equal(activeSoft.ok, true);
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

  it("records one Admin Activity row per editor write, and one per business on a move", async () => {
    const mod = await import("../dashboard/src/lib/packageVersionEditor.ts");
    const versionId = "11111111-1111-1111-1111-111111111111";
    const tenantA = "22222222-2222-2222-2222-222222222222";
    const tenantB = "33333333-3333-3333-3333-333333333333";
    const reason = "fixture reason";
    const version = {
      id: versionId,
      sku: "starter",
      name: "Starter",
      version: 2,
      status: "published",
      monthly_price_kes: "7000",
      minutes: 100,
    };
    const commands = [
      { action: "draft", sku: "starter", reason },
      { action: "update_draft", versionId, patch: {}, reason },
      { action: "publish", versionId, activeFrom: "2026-10-18T00:00:00Z", reason },
      { action: "archive", versionId, reason },
      { action: "discard_draft", versionId, reason },
      { action: "approve", versionId, reason },
      { action: "set_new_signup_trial", enabled: true, reason, confirm: true },
      { action: "set_price_approval_threshold", thresholdKes: 500, reason },
    ];
    const actions = {
      draft: "draft_package_version",
      update_draft: "update_package_version_draft",
      publish: "publish_package_version",
      archive: "archive_package_version",
      discard_draft: "discard_package_version_draft",
      approve: "approve_package_version",
      set_new_signup_trial: "set_new_signup_trial",
      set_price_approval_threshold: "set_price_approval_threshold",
    };
    for (const command of commands) {
      const entries = mod.packageEditorActivityEntries(command, { version }, {
        version: { ...version, status: "draft", monthly_price_kes: 6000 },
        signupEnabled: false,
        thresholdKes: "0",
      });
      assert.equal(entries.length, 1, command.action);
      assert.equal(entries[0].action, actions[command.action]);
      assert.equal(entries[0].reason, reason);
      assert.equal(entries[0].businessId ?? null, null);
    }

    const moved = mod.packageEditorActivityEntries(
      { action: "move_subscribers", versionId, tenantIds: [tenantA, tenantB], reason, confirm: true },
      { version },
      {
        businesses: [
          {
            id: tenantA,
            business_name: "Jirani",
            package_version_id: "44444444-4444-4444-4444-444444444444",
            billing_status: "beta",
            billing_enforcement: "off",
            minutes_included: 20,
          },
        ],
      },
    );
    assert.equal(moved.length, 2);
    assert.equal(moved[0].action, "move_package_version");
    assert.equal(moved[0].businessId, tenantA);
    assert.equal(moved[0].detail.business_name, "Jirani");
    assert.equal(moved[0].before.billing_status, "beta");
    assert.equal(moved[0].after.package_version_id, versionId);
    assert.equal(moved[0].after.minutes_included, 100);
    assert.equal(moved[0].after.billing_enforcement, "off");
    assert.equal(moved[1].businessId, tenantB);
    assert.equal(moved[1].before.package_version_id, null);

    const mode = mod.packageEditorActivityEntries(
      {
        action: "set_billing_mode",
        tenantId: tenantA,
        billingStatus: "active",
        enforcement: "soft",
        reason,
        confirm: true,
      },
      { tenant_id: tenantA, billing_status: "active", billing_enforcement: "soft" },
      {
        businesses: [
          { id: tenantA, business_name: "Jirani", billing_status: "beta", billing_enforcement: "off" },
        ],
      },
    );
    assert.equal(mode.length, 1);
    assert.equal(mode[0].action, "set_tenant_billing_mode");
    assert.equal(mode[0].businessId, tenantA);
    assert.deepEqual(mode[0].before, { billing_status: "beta", billing_enforcement: "off" });
    assert.deepEqual(mode[0].after, { billing_status: "active", billing_enforcement: "soft" });

    const priced = mod.packageEditorActivityEntries(
      { action: "update_draft", versionId, patch: {}, reason },
      { version },
      { version: { sku: "starter", version: 2, status: "draft", monthly_price_kes: "6000", minutes: 100 } },
    );
    assert.equal(priced[0].before.monthly_price_kes, 6000);
    assert.equal(priced[0].after.monthly_price_kes, 7000);

    const post = route.slice(route.indexOf("export async function POST"));
    const write = post.indexOf("runEditorCommand(actor");
    const audit = post.indexOf("recordAdminAction(");
    assert.ok(write > 0 && audit > write);
    assert.match(post, /packageEditorActivityEntries\(/);
    assert.match(post, /adminActorName\(\)/);
    assert.doesNotMatch(route, /actor:\s*body\./);
  });
});
