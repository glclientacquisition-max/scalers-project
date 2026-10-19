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
});
