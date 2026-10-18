/**
 * H4 and H9 from the billing stack review (PR #784).
 * Reads the working tree. Nothing here is applied.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function functionBody(sql, name) {
  const marker = `function public.${name}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `unterminated ${name}`);
  return sql.slice(start, end);
}

describe("package version editor SQL", () => {
  const sql = read("docs/supabase/package_version_editor.sql");

  it("refuses billing_status beta unless enforcement is off", () => {
    const body = functionBody(sql, "admin_set_tenant_billing_mode");
    assert.match(
      body,
      /if p_billing_status = 'beta' and p_enforcement is distinct from 'off' then\s+raise exception/
    );
    assert.match(body, /p_billing_status = 'active' and p_enforcement in \('soft', 'hard'\)/);
  });
});

describe("legacy billing mode and invoice freeze", () => {
  it("refuses to turn enforcement on while billing_status stays beta", () => {
    const sql = read("docs/supabase/wallet_security_beta.sql");
    const body = functionBody(sql, "set_tenant_billing_mode");
    assert.match(body, /billing_status/);
    assert.match(body, /tenant_subscriptions/);
    assert.match(body, /v_mode is distinct from 'off'/);
    assert.match(body, /raise exception 'billing stays off while the business is on beta'/);
  });

  it("points the admin billing action at the confirmed switch", () => {
    const route = read("dashboard/src/app/api/admin/billing/route.ts");
    const start = route.indexOf('action === "set_billing_mode"');
    const chunk = route.slice(start, start + 700);
    assert.match(chunk, /confirmTenantBillingMode/);
    assert.doesNotMatch(chunk, /setTenantBillingMode/);
    const helper = functionBodyTs(read("dashboard/src/lib/adminWallets.ts"), "confirmTenantBillingMode");
    assert.match(helper, /admin_set_tenant_billing_mode/);
    assert.match(helper, /p_confirm: true/);
    assert.match(helper, /p_billing_status: billingStatus/);
  });
});

function functionBodyTs(src, name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  return src.slice(start, start + 900);
}
