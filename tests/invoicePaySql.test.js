const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { splitKes } = require("../dashboard/src/lib/invoicePay/money");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let db;

async function q(sql, params) {
  return db.query(sql, params);
}

describe("invoice pay SQL", () => {
  before(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(read("tests/sql/billing_data_layer/00_stub_schema.sql"));
    await db.exec(read("tests/sql/billing_data_layer/05_legacy.sql"));
    await db.exec(read("docs/supabase/billing_data_layer.sql"));
    await db.exec(read("docs/supabase/invoice_pay.sql"));
    await db.exec(read("docs/supabase/invoice_pay.sql"));
    await db.exec(read("docs/supabase/invoice_documents.sql"));
    await db.exec(read("docs/supabase/invoice_documents.sql"));
    await db.exec(read("docs/supabase/billing_company.sql"));
    await db.exec(read("docs/supabase/billing_company.sql"));
  });

  it("splits the same way as the page", async () => {
    for (const total of ["150000", "150001", "200000", "2320.50", "300000.25"]) {
      const { rows } = await q("select public.invoice_kes_parts($1::numeric) as parts", [total]);
      const sqlParts = rows[0].parts.map((part) => {
        const n = Number(part);
        return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
      });
      const jsParts = splitKes(total).map((part) => (part.includes(".") ? part.replace(/0$/, "").replace(/\.$/, "") : part));
      assert.deepEqual(
        sqlParts.map((part) => Number(part).toFixed(2)),
        jsParts.map((part) => Number(part).toFixed(2)),
        total
      );
    }
  });

  it("refuses a beta tenant and mints, rotates, and expires a link for an enforced tenant", async () => {
    const beta = "11111111-1111-1111-1111-111111111111";
    await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes, due_at)
       values ($1, 2000, 2320, '2026-10-24 21:00:00+00')`,
      [beta]
    );
    await q(
      `update public.invoices set status = 'open', invoice_number = 'SC-2026-000010'
       where tenant_id = $1`,
      [beta]
    );
    await assert.rejects(
      q("select * from public.mint_invoice_pay_token((select id from public.invoices where tenant_id = $1), false)", [beta]),
      /beta tenants have no pay link/
    );

    const tenant = "44444444-4444-4444-4444-444444444444";
    await q("select set_config('scalers.wallet_write', '1', false)");
    await q(
      `insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement)
       values ($1, 'Pay Test Shop', 'pending:pay-test', 'soft')`,
      [tenant]
    );
    const inserted = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes, due_at)
       values ($1, 2000, 2320, '2026-10-24 21:00:00+00')
       returning id`,
      [tenant]
    );
    const invoiceId = inserted.rows[0].id;
    await q(
      `update public.invoices set status = 'open', invoice_number = 'SC-2026-000042' where id = $1`,
      [invoiceId]
    );

    const minted = await q("select * from public.mint_invoice_pay_token($1, false)", [invoiceId]);
    const token = minted.rows[0].token;
    assert.match(token, /^pay_[A-Za-z0-9_-]+$/);
    const stored = await q("select token_hash, expires_at, revoked_at from public.invoice_pay_tokens where invoice_id = $1", [
      invoiceId,
    ]);
    assert.equal(stored.rows.length, 1);
    assert.notEqual(stored.rows[0].token_hash, token);
    assert.equal(stored.rows[0].revoked_at, null);
    const hashed = await q("select encode(digest($1, 'sha256'), 'hex') as hash", [token]);
    assert.equal(stored.rows[0].token_hash, hashed.rows[0].hash);

    const preview = await q("select public.pay_invoice_by_token($1) as row", [token]);
    assert.equal(preview.rows[0].row.state, "payable");
    assert.equal(preview.rows[0].row.business_name, "Pay Test Shop");
    assert.equal(preview.rows[0].row.invoice_number, "SC-2026-000042");

    await assert.rejects(q("select * from public.mint_invoice_pay_token($1, false)", [invoiceId]), /already exists/);
    const rotated = await q("select * from public.mint_invoice_pay_token($1, true)", [invoiceId]);
    const nextToken = rotated.rows[0].token;
    assert.notEqual(nextToken, token);
    const oldPreview = await q("select public.pay_invoice_by_token($1) as row", [token]);
    assert.equal(oldPreview.rows[0].row.state, "expired");
    const newPreview = await q("select public.pay_invoice_by_token($1) as row", [nextToken]);
    assert.equal(newPreview.rows[0].row.state, "payable");

    await q("set role anon");
    await assert.rejects(q("select * from public.mint_invoice_pay_token($1, false)", [invoiceId]));
    await q("reset role");
  });

  it("applies two parts once each and leaves a mismatch unpaid", async () => {
    const tenant = "55555555-5555-4555-8555-555555555555";
    await q("select set_config('scalers.wallet_write', '1', false)");
    await q(
      `insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement)
       values ($1, 'Split Shop', 'pending:split', 'soft')`,
      [tenant]
    );
    const inserted = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes)
       values ($1, 200000, 200000) returning id`,
      [tenant]
    );
    const invoiceId = inserted.rows[0].id;
    await q("update public.invoices set status = 'open', invoice_number = 'SC-2026-000200' where id = $1", [invoiceId]);

    const first = await q(
      `select * from public.apply_payment('bachs', 'chk_part_1', 100000, $1, $2, now(), 'test', '{}'::jsonb)`,
      [tenant, invoiceId]
    );
    assert.equal(first.rows[0].match_status, "partial");
    const replay = await q(
      `select * from public.apply_payment('bachs', 'chk_part_1', 100000, $1, $2)`,
      [tenant, invoiceId]
    );
    assert.equal(replay.rows[0].id, first.rows[0].id);
    let invoice = await q("select status, amount_paid_kes from public.invoices where id = $1", [invoiceId]);
    assert.equal(invoice.rows[0].status, "open");
    assert.equal(Number(invoice.rows[0].amount_paid_kes), 100000);

    await q(
      `select * from public.apply_payment('bachs', 'chk_part_2', 100000, $1, $2)`,
      [tenant, invoiceId]
    );
    invoice = await q("select status, amount_paid_kes from public.invoices where id = $1", [invoiceId]);
    assert.equal(invoice.rows[0].status, "paid");
    assert.equal(Number(invoice.rows[0].amount_paid_kes), 200000);

    const other = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes)
       values ($1, 2320, 2320) returning id`,
      [tenant]
    );
    const otherId = other.rows[0].id;
    await q("update public.invoices set status = 'open', invoice_number = 'SC-2026-000201' where id = $1", [otherId]);
    const issue = await q(
      `select match_status from public.record_payment_issue(
         'bachs', 'chk_bad', 2000, $1, $2, '{}'::jsonb, 1800, 'USD', null, 'amount'
       )`,
      [tenant, otherId]
    );
    assert.equal(issue.rows[0].match_status, "issue");
    const still = await q("select status, amount_paid_kes from public.invoices where id = $1", [otherId]);
    assert.equal(still.rows[0].status, "open");
    assert.equal(Number(still.rows[0].amount_paid_kes), 0);
    const again = await q(
      `select id from public.record_payment_issue('bachs', 'chk_bad', 2000, $1, $2)`,
      [tenant, otherId]
    );
    const count = await q("select count(*)::int as n from public.payments where provider_ref = 'chk_bad'");
    assert.equal(count.rows[0].n, 1);
    assert.ok(again.rows[0].id);
  });

  it("reports a pending attempt older than 30 minutes and does not change it", async () => {
    const tenant = "55555555-5555-4555-8555-555555555555";
    const invoice = await q("select id from public.invoices where invoice_number = 'SC-2026-000201'");
    await q(
      `insert into public.payment_attempts (tenant_id, invoice_id, provider, status, amount_kes, created_at)
       values ($1, $2, 'bachs', 'pending', 2320, now() - interval '31 minutes')`,
      [tenant, invoice.rows[0].id]
    );
    const before = await q(
      "select status, amount_kes from public.payment_attempts where invoice_id = $1",
      [invoice.rows[0].id]
    );
    const report = await q(
      "select kind, detail from public.billing_payment_reconciliation() where invoice_id = $1",
      [invoice.rows[0].id]
    );
    const after = await q(
      "select status, amount_kes from public.payment_attempts where invoice_id = $1",
      [invoice.rows[0].id]
    );
    assert.deepEqual(after.rows, before.rows);
    assert.ok(report.rows.some((row) => row.kind === "pending_timeout"));
    assert.ok(report.rows.some((row) => row.kind === "issue"));
  });

  it("numbers issued invoices SCL- without a gap and leaves drafts unnumbered", async () => {
    const tenant = "66666666-6666-4666-8666-666666666666";
    await q(
      `insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement, alert_email)
       values ($1, 'Example Business', 'pending:pay-docs', 'soft', 'example@example.com')`,
      [tenant]
    );
    const first = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes, tax_kes)
       values ($1, 7000, 7000, null) returning id, invoice_number, status, tax_kes`,
      [tenant]
    );
    assert.equal(first.rows[0].invoice_number, null);
    assert.equal(first.rows[0].status, "draft");
    assert.equal(first.rows[0].tax_kes, null);
    const issued = await q(
      `select invoice_number, status, issuer_legal_name, issuer_product, issuer_phone, issuer_email,
              issuer_address, issuer_city, issuer_kra_pin
       from public.finalize_invoice($1)`,
      [first.rows[0].id]
    );
    const year = await q("select extract(year from (now() at time zone 'Africa/Nairobi'))::int as y");
    assert.match(issued.rows[0].invoice_number, new RegExp(`^SCL-${year.rows[0].y}-\\d{6}$`));
    assert.equal(issued.rows[0].status, "open");
    assert.equal(issued.rows[0].issuer_legal_name, "Scalers Ventures");
    assert.equal(issued.rows[0].issuer_product, "Business Assistant");
    assert.equal(issued.rows[0].issuer_phone, "+254119774470");
    assert.equal(issued.rows[0].issuer_email, "support@scalers.co.ke");
    assert.equal(issued.rows[0].issuer_address, null);
    assert.equal(issued.rows[0].issuer_city, null);
    assert.equal(issued.rows[0].issuer_kra_pin, null);
    await q(
      `update public.billing_company
       set legal_name = 'Scalers Ventures Ltd', phone = '  +254700000000  ',
           address = 'Westlands', city = 'Nairobi', kra_pin = 'A123456789B', updated_at = now()
       where id = 1`
    );
    const second = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, 1000, 1000) returning id, invoice_number`,
      [tenant]
    );
    assert.equal(second.rows[0].invoice_number, null);
    const issued2 = await q(
      `select invoice_number, issuer_legal_name, issuer_phone, issuer_address, issuer_city, issuer_kra_pin
       from public.finalize_invoice($1)`,
      [second.rows[0].id]
    );
    assert.equal(issued2.rows[0].issuer_legal_name, "Scalers Ventures Ltd");
    assert.equal(issued2.rows[0].issuer_phone, "+254700000000");
    assert.equal(issued2.rows[0].issuer_address, "Westlands");
    assert.equal(issued2.rows[0].issuer_city, "Nairobi");
    assert.equal(issued2.rows[0].issuer_kra_pin, "A123456789B");
    const firstStill = await q(
      `select issuer_legal_name, issuer_phone, issuer_address, issuer_kra_pin from public.invoices where id = $1`,
      [first.rows[0].id]
    );
    assert.equal(firstStill.rows[0].issuer_legal_name, "Scalers Ventures");
    assert.equal(firstStill.rows[0].issuer_phone, "+254119774470");
    assert.equal(firstStill.rows[0].issuer_address, null);
    assert.equal(firstStill.rows[0].issuer_kra_pin, null);
    const n1 = Number(issued.rows[0].invoice_number.slice(-6));
    const n2 = Number(issued2.rows[0].invoice_number.slice(-6));
    assert.equal(n2, n1 + 1);
    const notice = await q(
      `select kind, body, delivery_status, billed_to from public.billing_notices
       where tenant_id = $1 and kind = 'platform_billing_invoice_issued'`,
      [tenant]
    );
    assert.equal(notice.rows.length, 2);
    assert.equal(notice.rows[0].delivery_status, "pending");
    assert.equal(notice.rows[0].billed_to, "platform");
    assert.match(notice.rows[0].body, /Business Assistant/);
    assert.match(notice.rows[0].body, /KSh/);
    assert.doesNotMatch(notice.rows[0].body, /VAT/);
  });

  it("does not issue or burn a number when the company row is missing", async () => {
    const tenant = "66666666-6666-4666-8666-666666666666";
    const before = await q("select coalesce(max(last_number), 0)::int as n from public.billing_invoice_counters");
    const draft = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, 10, 10) returning id`,
      [tenant]
    );
    await q("delete from public.billing_company where id = 1");
    await assert.rejects(() => q("select public.finalize_invoice($1)", [draft.rows[0].id]), /billing company is not set/);
    const still = await q("select status, invoice_number from public.invoices where id = $1", [draft.rows[0].id]);
    assert.equal(still.rows[0].status, "draft");
    assert.equal(still.rows[0].invoice_number, null);
    const after = await q("select coalesce(max(last_number), 0)::int as n from public.billing_invoice_counters");
    assert.equal(Number(after.rows[0].n), Number(before.rows[0].n));
    await q(
      `insert into public.billing_company (id, legal_name, product, phone, email)
       values (1, 'Scalers Ventures', 'Business Assistant', '+254119774470', 'support@scalers.co.ke')
       on conflict (id) do nothing`
    );
  });

  it("issues a receipt when a payment is recorded and flags an overpaid webhook", async () => {
    const tenant = "66666666-6666-4666-8666-666666666666";
    const invoice = await q(
      `select id from public.invoices where tenant_id = $1 and status = 'open' order by created_at limit 1`,
      [tenant]
    );
    const invoiceId = invoice.rows[0].id;
    await q("select public.mint_invoice_pay_token($1, false)", [invoiceId]);
    const applied = await q(
      `select id, match_status from public.apply_payment(
         'bachs', 'chk_docs_1', 7000, $1, $2, now(), 'bachs-webhook',
         '{"data":{"status":"OVERPAID"}}'::jsonb
       )`,
      [tenant, invoiceId]
    );
    assert.equal(applied.rows[0].match_status, "matched");
    const receipt = await q(
      "select receipt_number, method, provider_ref, amount_kes from public.invoice_receipts where payment_id = $1",
      [applied.rows[0].id]
    );
    assert.match(receipt.rows[0].receipt_number, /^RCT-\d{4}-\d{6}$/);
    assert.equal(receipt.rows[0].method, "M-Pesa");
    assert.equal(receipt.rows[0].provider_ref, "chk_docs_1");
    const again = await q("select receipt_number from public.issue_invoice_receipt($1)", [applied.rows[0].id]);
    const count = await q("select count(*)::int as n from public.invoice_receipts where payment_id = $1", [
      applied.rows[0].id,
    ]);
    assert.equal(count.rows[0].n, 1);
    assert.equal(again.rows[0].receipt_number, receipt.rows[0].receipt_number);
    const report = await q(
      `insert into public.payment_attempts (tenant_id, invoice_id, provider, checkout_session_id, status, amount_kes)
       values ($1, $2, 'bachs', 'chk_docs_1', 'succeeded', 7000)`,
      [tenant, invoiceId]
    );
    assert.ok(report);
    const rows = await q(
      "select kind from public.billing_payment_reconciliation() where invoice_id = $1 and kind = 'overpaid'",
      [invoiceId]
    );
    assert.equal(rows.rows.length, 1);
    const mail = await q(
      `select body, delivery_status from public.billing_notices
       where tenant_id = $1 and kind = 'platform_billing_payment_received'`,
      [tenant]
    );
    assert.equal(mail.rows[0].delivery_status, "pending");
    assert.match(mail.rows[0].body, /Receipt RCT-/);
    assert.doesNotMatch(mail.rows[0].body, /VAT/);
  });

  it("refuses a pay link and finalize while billing_status is beta, and refuses an http checkout url", async () => {
    const tenant = "77777777-7777-4777-8777-777777777777";
    await q("select set_config('scalers.wallet_write', '1', false)");
    await q(
      `insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement)
       values ($1, 'Beta Status Shop', 'pending:beta-status', 'soft')`,
      [tenant]
    );
    const pkg = await q("select id from public.billing_packages order by sort_order limit 1");
    await q(
      `insert into public.tenant_subscriptions (tenant_id, package_id, billing_status)
       values ($1, $2, 'beta')`,
      [tenant, pkg.rows[0].id]
    );
    const draft = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, 1000, 1000) returning id`,
      [tenant]
    );
    await assert.rejects(q("select public.finalize_invoice($1)", [draft.rows[0].id]), /beta tenants have no pay link/);
    await q(`update public.invoices set status = 'open', invoice_number = 'SCL-2026-000077' where id = $1`, [
      draft.rows[0].id,
    ]);
    await assert.rejects(q("select * from public.mint_invoice_pay_token($1, false)", [draft.rows[0].id]), /beta tenants have no pay link/);
    await assert.rejects(
      q(
        "select public.attach_invoice_pay_checkout('00000000-0000-4000-8000-000000000099', 'cs_http', 'http://example.test/c', now())"
      ),
      /checkout url refused/
    );
  });

  it("turns a negative draft into one credit and a paid zero invoice", async () => {
    const tenant = "88888888-8888-4888-8888-888888888888";
    await q(
      `insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement)
       values ($1, 'Credit Shop', 'pending:credit', 'soft')`,
      [tenant]
    );
    const draft = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, -400, -400) returning id`,
      [tenant]
    );
    const issued = await q(
      `select status, total_kes, subtotal_kes, invoice_number, paid_at from public.finalize_invoice($1)`,
      [draft.rows[0].id]
    );
    assert.equal(issued.rows[0].status, "paid");
    assert.equal(Number(issued.rows[0].total_kes), 0);
    assert.equal(Number(issued.rows[0].subtotal_kes), 0);
    assert.match(issued.rows[0].invoice_number, /^SCL-\d{4}-\d{6}$/);
    assert.ok(issued.rows[0].paid_at);
    const credits = await q(
      `select amount_kes, reason from public.tenant_credits where idempotency_key = $1`,
      [`invoice-credit:${draft.rows[0].id}`]
    );
    assert.equal(credits.rows.length, 1);
    assert.equal(Number(credits.rows[0].amount_kes), 400);
    assert.equal(credits.rows[0].reason, "invoice_credit");
    const receipts = await q("select count(*)::int as n from public.invoice_receipts where invoice_id = $1", [
      draft.rows[0].id,
    ]);
    assert.equal(receipts.rows[0].n, 0);
    const notice = await q(
      `select count(*)::int as n from public.billing_notices
       where idempotency_key = $1`,
      [`platform_billing_invoice_issued:${draft.rows[0].id}`]
    );
    assert.equal(notice.rows[0].n, 0);
    const body = await q("select pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure) as def");
    assert.match(body.rows[0].def, /scalers\.billing_write/);
    assert.match(body.rows[0].def, /invoice-credit:/);
    assert.match(body.rows[0].def, /SCL-/);
    assert.doesNotMatch(read("docs/supabase/invoice_documents.sql"), /function public\.finalize_invoice/);
  });

  it("updates one receipt when the collected amount rises", async () => {
    const tenant = "88888888-8888-4888-8888-888888888888";
    const draft = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, 500, 500) returning id`,
      [tenant]
    );
    const issued = await q("select id from public.finalize_invoice($1)", [draft.rows[0].id]);
    const applied = await q(
      `select id, amount_kes from public.apply_payment('bachs', 'chk_over_1', 500, $1, $2)`,
      [tenant, issued.rows[0].id]
    );
    const before = await q(
      "select receipt_number, amount_kes from public.invoice_receipts where payment_id = $1",
      [applied.rows[0].id]
    );
    await q("select public.adjust_payment_overpay('bachs', 'chk_over_1', 700, $1)", [tenant]);
    const after = await q(
      "select receipt_number, amount_kes from public.invoice_receipts where payment_id = $1",
      [applied.rows[0].id]
    );
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].receipt_number, before.rows[0].receipt_number);
    assert.equal(Number(after.rows[0].amount_kes), 700);
  });

  it("expires a return id and credits a cancelled collection once", async () => {
    const tenant = "88888888-8888-4888-8888-888888888888";
    const draft = await q(
      `insert into public.invoices (tenant_id, subtotal_kes, total_kes) values ($1, 2320, 2320) returning id`,
      [tenant]
    );
    const invoice = await q("select id from public.finalize_invoice($1)", [draft.rows[0].id]);
    await q(
      `insert into public.payment_attempts (
         tenant_id, invoice_id, provider, checkout_session_id, status, amount_kes, return_id, return_expires_at
       ) values ($1, $2, 'bachs', 'chk_cancel_1', 'cancelled', 500, 'ret_old', now() - interval '1 hour')`,
      [tenant, invoice.rows[0].id]
    );
    const stale = await q("select public.pay_invoice_by_return('ret_old') as row");
    assert.equal(stale.rows[0].row.state, "expired");
    await q(
      `insert into public.payment_attempts (
         tenant_id, invoice_id, provider, status, amount_kes, return_id, return_expires_at
       ) values ($1, $2, 'bachs', 'pending', 500, 'ret_fresh', now() + interval '1 hour')`,
      [tenant, invoice.rows[0].id]
    );
    const fresh = await q("select public.pay_invoice_by_return('ret_fresh') as row");
    assert.equal(fresh.rows[0].row.found, true);
    assert.notEqual(fresh.rows[0].row.state, "expired");
    await q("select public.record_payment_issue('bachs', 'chk_cancel_1', 500, $1, $2, '{}'::jsonb, null, null, null, 'cancelled')", [
      tenant,
      invoice.rows[0].id,
    ]);
    await q("select public.credit_cancelled_collection('bachs', 'chk_cancel_1', 500, $1)", [tenant]);
    await q("select public.credit_cancelled_collection('bachs', 'chk_cancel_1', 500, $1)", [tenant]);
    const credits = await q(
      "select count(*)::int as n from public.tenant_credits where idempotency_key = 'cancelled:bachs:chk_cancel_1'"
    );
    assert.equal(credits.rows[0].n, 1);
    const audits = await q(
      "select count(*)::int as n from public.billing_audit_log where action = 'cancelled_checkout_credit'"
    );
    assert.equal(audits.rows[0].n, 1);
    const report = await q(
      "select kind, detail from public.billing_payment_reconciliation() where invoice_id = $1",
      [invoice.rows[0].id]
    );
    assert.ok(report.rows.some((row) => row.kind === "credited_cancelled"));
    assert.ok(!report.rows.some((row) => row.detail === "Collected on a cancelled checkout with no credit"));
    const column = await q(
      `select is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'updated_at'`
    );
    assert.equal(column.rows[0].is_nullable, "NO");
    assert.match(column.rows[0].column_default, /now\(\)/);
    assert.doesNotMatch(read("docs/supabase/invoice_pay.sql"), /updated_at timestamptz not null default now\(\)/);
  });
});
