/**
 * Contracts pulled from the billing stack review for this data layer:
 * draft invoices cannot take a number, finalize_invoice will not revert
 * SCL- numbering, and billing_status NOT NULL is its own short script.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function functionBody(sql, name) {
  const marker = `function public.${name}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `unterminated ${name}`);
  return sql.slice(start, end);
}

describe("legacy billing mode and invoice freeze", () => {
  it("does not let a draft update occupy the next invoice number", () => {
    const sql = read("docs/supabase/billing_data_layer.sql");
    const body = functionBody(sql, "invoices_freeze");
    assert.match(body, /new\.invoice_number is not null|new\.status is distinct from 'draft'/);
    assert.match(body, /new\.invoice_number is not null/);
    assert.match(body, /new\.status is distinct from 'draft'/);
  });
});

describe("finalize_invoice re-apply", () => {
  it("warns not to re-run after invoice_documents.sql and skips an SCL- body", () => {
    const sql = read("docs/supabase/billing_data_layer.sql");
    const start = sql.indexOf("finalize_invoice (data-layer numbering)");
    const end = sql.indexOf("create or replace function public.apply_payment");
    const chunk = sql.slice(start, end);
    assert.match(chunk, /Do not re-run this function after invoice_documents\.sql \(#780\)/);
    assert.match(chunk, /like '%SCL-%'/);
    assert.match(chunk, /leaving the invoice_documents\.sql body in place/);
    assert.doesNotMatch(chunk.slice(chunk.indexOf("$fn$")), /SCL-/);
  });
});

describe("production billing apply order", () => {
  it("lists the six files under distinct step numbers", () => {
    const readme = read("docs/supabase/README.md");
    const start = readme.indexOf("## Production billing apply order");
    assert.ok(start > 0);
    const next = readme.indexOf("\n## ", start + 1);
    const chunk = readme.slice(start, next > 0 ? next : undefined);
    const steps = [
      ["P1", "billing_data_layer.sql"],
      ["P2", "billing_data_layer_billing_status_not_null.sql"],
      ["P3", "extra_seat_monthly_kes"],
      ["P4", "owner_billing_actions.sql"],
      ["P5", "invoice_pay.sql"],
      ["P6", "invoice_documents.sql"],
      ["P7", "package_version_editor.sql"],
    ];
    let at = 0;
    for (const [step, file] of steps) {
      const stepAt = chunk.indexOf(`| ${step} |`, at);
      const fileAt = chunk.indexOf(file, stepAt);
      assert.ok(stepAt > at, `missing step ${step}`);
      assert.ok(fileAt > stepAt, `${file} is not under ${step}`);
      at = fileAt;
    }
  });
});

describe("billing_status NOT NULL", () => {
  it("uses a NOT VALID check, then VALIDATE, outside the index builds", () => {
    const layer = read("docs/supabase/billing_data_layer.sql");
    assert.doesNotMatch(layer, /alter column billing_status set not null/i);
    const sql = read("docs/supabase/billing_data_layer_billing_status_not_null.sql");
    assert.match(sql, /not valid/i);
    assert.match(sql, /validate constraint tenant_subscriptions_billing_status_not_null/i);
    assert.match(sql, /ACCESS EXCLUSIVE/);
    assert.match(sql, /SHARE UPDATE EXCLUSIVE/);
    const down = read("docs/supabase/billing_data_layer_down.sql");
    assert.match(down, /alter column billing_status drop not null/);
    assert.match(down, /drop column if exists billing_status/);
  });
});
