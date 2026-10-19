const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertLiveTenant } = require("../dashboard/src/lib/invoicePay/provider");
const { billingCronAllows } = require("../dashboard/src/lib/invoicePay/cronAuth");
const { liveTenantPostError } = require("../dashboard/src/lib/invoicePay/liveTenantsApi");
const { billingReconcileReport, reconciliationCounts } = require("../dashboard/src/lib/invoicePay/reconcile");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const TENANT = "33333333-3333-4333-8333-333333333333";

const liveEnv = (extra = {}) => ({
  BACHS_MODE: "live",
  BACHS_LIVE_ALLOWED: "true",
  BACHS_LIVE_TENANT_ALLOWLIST: "",
  ...extra,
});

describe("live tenant gate", () => {
  it("refuses when the master switch is off, even if the database and the env list say yes", async () => {
    let reads = 0;
    await assert.rejects(
      () => assertLiveTenant(TENANT, liveEnv({
        BACHS_LIVE_ALLOWED: "false",
        BACHS_LIVE_TENANT_ALLOWLIST: TENANT,
      }), async () => {
        reads += 1;
        return true;
      }),
      /refused/
    );
    assert.equal(reads, 0);
  });

  it("allows a database row or an env-list hit, and denies a database error", async () => {
    await assertLiveTenant(TENANT, liveEnv(), async () => true);
    await assertLiveTenant(TENANT, liveEnv({ BACHS_LIVE_TENANT_ALLOWLIST: TENANT }), async () => {
      throw new Error("db down");
    });
    await assert.rejects(
      () => assertLiveTenant(TENANT, liveEnv(), async () => {
        throw new Error("db down");
      }),
      /not open for this business/
    );
    await assert.rejects(
      () => assertLiveTenant(TENANT, liveEnv(), async () => false),
      /not open for this business/
    );
  });
});

describe("live tenant and reconcile routes", () => {
  it("requires the cron secret, a super admin, and confirm plus a reason", () => {
    assert.equal(billingCronAllows(null, ""), false);
    assert.equal(billingCronAllows("Bearer secret", ""), false);
    assert.equal(billingCronAllows("Bearer no", "secret"), false);
    assert.equal(billingCronAllows("Bearer secret", "secret"), true);

    assert.equal(liveTenantPostError({}), "confirm");
    assert.equal(liveTenantPostError({ confirm: "true", reason: "Because", tenantId: TENANT, enabled: true }), "confirm");
    assert.equal(liveTenantPostError({ confirm: true, reason: "  ", tenantId: TENANT, enabled: true }), "reason");
    assert.equal(liveTenantPostError({ confirm: true, reason: "Because", tenantId: TENANT, enabled: true }), null);

    const cron = read("dashboard/src/app/api/cron/billing-reconcile/route.ts");
    assert.match(cron, /billingPaymentCronOk/);
    assert.match(cron, /status: 401/);
    assert.match(cron, /billing_payment_reconciliation/);
    assert.match(cron, /matched: counts\.matched/);
    assert.match(cron, /missing_ours: counts\.missing_ours/);
    assert.match(cron, /missing_bachs: counts\.missing_bachs/);
    assert.doesNotMatch(cron, /process\.env\./);
    assert.doesNotMatch(cron, /reconcile_checkout_total|settle_checkout_reading|\.update\(|\.insert\(/);

    const retry = read("dashboard/src/app/api/cron/billing-payment-retry/route.ts");
    assert.match(retry, /process\.env\.CRON_SECRET/);
    assert.match(retry, /billingPaymentCronOk/);

    const admin = read("dashboard/src/app/api/billing/live-tenants/route.ts");
    assert.match(admin, /requireSuperAdmin/);
    assert.match(admin, /from "@\/lib\/adminGuard"/);
    assert.match(admin, /liveTenantPostError/);
    assert.match(admin, /admin_set_tenant_live_payments/);
    assert.doesNotMatch(admin, /process\.env\./);

    const vercel = JSON.parse(read("dashboard/vercel.json"));
    assert.equal(vercel.crons, undefined);
    assert.doesNotMatch(JSON.stringify(vercel), /billing-reconcile/);

    const readme = read("docs/supabase/README.md");
    const p16 = readme.indexOf("| P16 |");
    const p17 = readme.indexOf("| P17 |");
    assert.ok(p16 > 0 && p17 > p16);
    assert.match(read("tests/sql/billing_apply_order/run.sh"), /P17 invoice_pay_live_allowlist\.sql/);
    assert.match(read("docs/supabase/MIGRATION_LEDGER.md"), /LEDGER-INVOICE-PAY-LIVE-ALLOWLIST/);
    const sql = read("docs/supabase/invoice_pay_live_allowlist.sql");
    assert.doesNotMatch(sql, /values\s*\(\s*'[0-9a-f-]{36}'/i);
    assert.doesNotMatch(sql, /insert into public\.tenants/i);
  });

  it("returns matched, mismatch, missing_ours, and missing_bachs without calling Bachs when the mode is off", async () => {
    assert.deepEqual(reconciliationCounts({
      rows: [{ kind: "status_disagreement" }, { kind: "pending_timeout" }],
      remotes: null,
    }), { matched: 0, mismatch: 1, missing_ours: 0, missing_bachs: 0 });

    let calls = 0;
    const quiet = await billingReconcileReport({
      env: { BACHS_MODE: "off" },
      async listRows() {
        return [
          { kind: "status_disagreement", attemptId: "a", paymentId: null },
          { kind: "pending_timeout", attemptId: "b", paymentId: null },
        ];
      },
      async getCheckout() {
        calls += 1;
        return null;
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(quiet, { matched: 0, mismatch: 1, missing_ours: 0, missing_bachs: 0 });

    const compared = await billingReconcileReport({
      env: { BACHS_MODE: "sandbox", BACHS_API_KEY: "sk_test_x", SUPABASE_URL: "https://example.supabase.co" },
      async listRows() {
        return [
          { kind: "pending_timeout", attemptId: "gone", paymentId: null },
          { kind: "pending_timeout", attemptId: "paid", paymentId: "pay-1" },
          { kind: "status_disagreement", attemptId: "short", paymentId: null },
          { kind: "status_disagreement", attemptId: null, paymentId: null },
        ];
      },
      async loadAttempts() {
        return [
          { id: "gone", checkoutSessionId: "chk_gone", status: "pending" },
          { id: "paid", checkoutSessionId: "chk_paid", status: "succeeded" },
          { id: "short", checkoutSessionId: "chk_short", status: "pending" },
        ];
      },
      async getCheckout(id) {
        calls += 1;
        if (id === "chk_gone") return null;
        if (id === "chk_paid") return { paymentStatus: "paid" };
        if (id === "chk_short") return { paymentStatus: "paid" };
        return { paymentStatus: "open" };
      },
    });
    assert.equal(calls, 3);
    assert.deepEqual(compared, { matched: 1, mismatch: 1, missing_ours: 1, missing_bachs: 1 });
  });
});
