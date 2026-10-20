const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  issueKsh10TestInvoice,
  testInvoiceFailure,
  testInvoicePostError,
  TEST_LINE,
} = require("../dashboard/src/lib/invoicePay/testInvoice");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const TENANT = "33333333-3333-4333-8333-333333333333";

function tenant(extra = {}) {
  return {
    id: TENANT,
    billing_enforcement: "soft",
    billing_status: "active",
    archived_at: null,
    sautikit_virtual_number: "+254700000000",
    minutes_included: 100,
    package_version_id: "ver-1",
    monthly_price_kes: 2500,
    ...extra,
  };
}

function db(state) {
  const calls = [];
  return {
    calls,
    async loadTenant() {
      calls.push("load");
      return state.tenant;
    },
    async findTestInvoices() {
      calls.push("find");
      return state.invoices;
    },
    async insertDraft(row) {
      calls.push(["draft", row]);
      state.invoices.push({ id: "inv-1", status: "draft", total_kes: 10, invoice_number: null, has_token: false });
      return "inv-1";
    },
    async insertLine(row) {
      calls.push(["line", row]);
    },
    async finalize(id) {
      calls.push(["finalize", id]);
      return { id, status: "open", total_kes: 10, tax_kes: null, invoice_number: "SCL-2026-000010" };
    },
    async mint(id) {
      calls.push(["mint", id]);
      return { token: "pay_once", expires_at: "2026-10-26T00:00:00.000Z" };
    },
    async audit(row) {
      calls.push(["audit", row]);
    },
  };
}

describe("KSh 10 test invoice", () => {
  it("refuses a body that names an amount", () => {
    assert.equal(testInvoicePostError({ confirm: true, reason: "live test", tenantId: TENANT, amount: 10 }), "The test invoice is KSh 10.");
    assert.equal(testInvoicePostError({ confirm: true, reason: "live test", tenantId: TENANT }), null);
  });

  it("opens one KSh 10 draft and the existing pay link without touching the plan", async () => {
    const store = db({ tenant: tenant(), invoices: [] });
    const issued = await issueKsh10TestInvoice(store, {
      tenantId: TENANT,
      actor: "ada",
      reason: "KSh 10 live payment test",
    });
    assert.equal(issued.pay_path, "/pay/pay_once");
    assert.equal(issued.invoice_number, "SCL-2026-000010");
    const draft = store.calls.find((call) => Array.isArray(call) && call[0] === "draft")[1];
    assert.equal(draft.billing_source, null);
    assert.equal(draft.total_kes, 10);
    assert.equal(draft.tax_kes, null);
    const line = store.calls.find((call) => Array.isArray(call) && call[0] === "line")[1];
    assert.equal(line.description, TEST_LINE);
    assert.equal(line.unit_amount_kes, 10);
    assert.deepEqual(store.calls.map((call) => (Array.isArray(call) ? call[0] : call)).filter((name) => name !== "load" && name !== "find"), [
      "draft",
      "line",
      "finalize",
      "mint",
      "audit",
    ]);
  });

  it("stops when the business is still on beta, is Aris, or already has a pay link", async () => {
    await assert.rejects(
      () => issueKsh10TestInvoice(db({ tenant: tenant({ billing_status: "beta" }), invoices: [] }), {
        tenantId: TENANT, actor: "ada", reason: "test",
      }),
      /still on beta/
    );
    await assert.rejects(
      () => issueKsh10TestInvoice(db({ tenant: tenant({ sautikit_virtual_number: "+254709221536" }), invoices: [] }), {
        tenantId: TENANT, actor: "ada", reason: "test",
      }),
      /Aris/
    );
    await assert.rejects(
      () => issueKsh10TestInvoice(db({
        tenant: tenant(),
        invoices: [{ id: "inv-1", status: "open", total_kes: 10, invoice_number: "SCL-1", has_token: true }],
      }), { tenantId: TENANT, actor: "ada", reason: "test" }),
      /already issued/
    );
  });

  it("refuses to hand over the link when the plan price moved", async () => {
    const store = db({ tenant: tenant(), invoices: [] });
    const first = store.loadTenant;
    let n = 0;
    store.loadTenant = async () => {
      n += 1;
      const row = await first();
      return n === 1 ? row : { ...row, monthly_price_kes: 1 };
    };
    await assert.rejects(
      () => issueKsh10TestInvoice(store, { tenantId: TENANT, actor: "ada", reason: "test" }),
      /must not change the plan/
    );
    assert.equal(store.calls.some((call) => Array.isArray(call) && call[0] === "mint"), false);
  });
});

describe("Jirani SQL and the admin route", () => {
  const sql = read("docs/runbooks/ksh10-live-test-jirani.sql");
  const route = read("dashboard/src/app/api/admin/billing/test-invoice/route.ts");
  const helper = read("dashboard/src/lib/invoicePay/testInvoice.js");

  it("looks Jirani up by name and fails closed", () => {
    assert.match(sql, /business_name ilike '%jirani%'/);
    assert.match(sql, /expected one business named Jirani, found %/);
    assert.match(sql, /v_n <> 1/);
    assert.match(sql, /254709221536/);
    assert.match(sql, /admin_set_tenant_billing_mode/);
    assert.match(sql, /admin_set_tenant_live_payments\(v_id, true/);
    assert.match(sql, /admin_set_tenant_live_payments\(v_id, false/);
    assert.match(sql, /'beta', 'off'/);
    assert.match(sql, /finalize_invoice/);
    assert.match(sql, /mint_invoice_pay_token/);
    assert.match(sql, /billing_source, tax_kes/);
    assert.doesNotMatch(sql, /owner_change_plan|monthly_price_kes\s*=/);
    assert.doesNotMatch(sql, /billing_source,\s*'next'|billing_source,\s*'proration'/);
  });

  it("is Super Admin only and uses the existing pay link", () => {
    assert.match(route, /requireSuperAdmin/);
    assert.match(route, /issueKsh10TestInvoice/);
    assert.match(helper, /finalize_invoice/);
    assert.match(helper, /mint_invoice_pay_token/);
    assert.match(helper, /billing_source: null/);
    assert.doesNotMatch(helper, /owner_change_plan|admin_set_tenant_billing_mode|\.update\(/);
    assert.doesNotMatch(route, /status:\s*401/);
    assert.doesNotMatch(route, /error:\s*message\b/);
    assert.match(route, /testInvoiceFailure/);
  });

  it("answers with a fixed sentence and keeps the raw error out of the response", () => {
    assert.deepEqual(testInvoiceFailure(new Error("This business is still on beta.")), {
      status: 409,
      error: "This business is still on beta.",
    });
    assert.deepEqual(testInvoiceFailure(new Error("refusing the Aris line")), {
      status: 409,
      error: "That line cannot take a test invoice.",
    });
    assert.deepEqual(testInvoiceFailure(new Error("a test invoice must not change the plan")), {
      status: 409,
      error: "The plan did not stay the same.",
    });
    assert.equal(testInvoiceFailure(new Error("test invoice already paid")).status, 409);
    assert.equal(testInvoiceFailure(new Error("pay link already issued")).status, 409);
    const leaked = testInvoiceFailure(new Error("relation invoices does not exist"));
    assert.equal(leaked.status, 400);
    assert.equal(leaked.error, "Could not open the test invoice.");
    assert.doesNotMatch(leaked.error, /relation|invoices/);
  });
});
