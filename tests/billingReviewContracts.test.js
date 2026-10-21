/**
 * Billing contracts that now live in this checkout: pay path, owner actions,
 * and the invoice freeze. They read the files here, not another branch.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function functionBody(sql, name) {
  const marker = `function public.${name}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `unterminated ${name}`);
  return sql.slice(start, end);
}

describe("legacy billing mode and invoice freeze", () => {
  it("revokes execute on payments_issue_receipt from public", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/invoice_documents.sql"), "utf8");
    const start = sql.indexOf("function public.payments_issue_receipt");
    const chunk = sql.slice(start, start + 1200);
    assert.match(chunk, /revoke all on function public\.payments_issue_receipt\(\) from public, anon, authenticated/);
  });

  it("keeps the draft number and status guard", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/billing_data_layer.sql"), "utf8");
    assert.match(sql, /invoice number and status are set only by finalize_invoice/);
  });

  it("sets billing_write inside apply_payment before it writes invoice status", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/invoice_pay.sql"), "utf8");
    const body = functionBody(sql, "apply_payment");
    const flag = body.indexOf("set_config('scalers.billing_write', '1', true)");
    const status = body.indexOf("status = 'paid'");
    assert.ok(flag >= 0 && status > flag);
  });

  it("refuses enforcement while a subscription is still beta", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/billing_mode_legal_pairs.sql"), "utf8");
    const body = functionBody(sql, "set_tenant_billing_mode");
    assert.match(body, /billing_status = 'beta'/);
    assert.match(body, /billing stays off while the business is on beta/);
    assert.doesNotMatch(body, /set\s+billing_status/);
  });
});

describe("Bachs webhook route", () => {
  it("logs a failed apply and does not answer 500 when the invoice cannot be paid", () => {
    const route = fs.readFileSync(
      path.join(__dirname, "../dashboard/src/app/api/billing/bachs/webhook/route.ts"),
      "utf8"
    );
    assert.match(route, /console\.error/);
    assert.match(route, /invoice cannot be paid/);
    assert.doesNotMatch(route, /catch \{\s*return NextResponse\.json\(\{ ok: false \}, \{ status: 500 \}\);\s*\}/);
  });
});

describe("owner billing actions SQL", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/owner_billing_actions.sql"), "utf8");

  it("defaults the spend cap from spend_limit_share_percent, including a beta subscription", () => {
    const body = functionBody(sql, "billing_spend_limit_kes");
    assert.match(body, /spend_limit_share_percent/);
    assert.doesNotMatch(body, /v_monthly \* 0\.5/);
    assert.match(body, /billing_status/);
  });

  it("debits on-demand seconds from the pinned package version and skips billing_status beta", () => {
    const body = functionBody(sql, "consume_call_seconds");
    assert.match(body, /billing_package_versions/);
    assert.match(body, /billing_status = 'beta'/);
    assert.match(body, /rate_missing/);
    assert.doesNotMatch(body, /v_rate := coalesce\(v_rate, 0\)/);
    assert.doesNotMatch(body, /from public\.billing_rate_card/);
  });

  it("issues SCL- invoices through finalize_invoice with the freeze flag", () => {
    const body = functionBody(sql, "finalize_invoice");
    assert.match(body, /set_config\('scalers\.billing_write', '1', true\)/);
    assert.match(body, /'SCL-' \|\|/);
    assert.match(body, /invoice-credit:/);
    assert.doesNotMatch(body, /'SC-' \|\|/);
    assert.match(sql, /billing_company/);
    assert.match(sql, /issuer_legal_name/);
    const proration = functionBody(sql, "_owner_open_proration_invoice");
    assert.match(proration, /finalize_invoice/);
    assert.doesNotMatch(proration, /invoice_number/);
  });

  it("refuses active billing without a pinned version", () => {
    const body = functionBody(sql, "tenant_subscriptions_c_require_version_pin");
    assert.match(body, /billing_status = 'active'/);
    assert.match(body, /package_version_id is null/);
  });

  it("disables the editor freeze while backfilling extra_seat_monthly_kes", () => {
    const at = sql.indexOf("set extra_seat_monthly_kes = 500");
    assert.ok(at > 0);
    const window = sql.slice(Math.max(0, at - 800), at + 500);
    assert.match(window, /disable trigger\s+billing_package_versions_freeze/i);
  });
});

describe("member wallet debit and period roll", () => {
  const actions = fs.readFileSync(path.join(__dirname, "../docs/supabase/owner_billing_actions.sql"), "utf8");

  it("revokes consume_sms_units from authenticated and skips a beta subscription", () => {
    const start = actions.indexOf("function public.consume_sms_units");
    const end = actions.indexOf("function public.reserve_notify_send", start);
    const chunk = actions.slice(start, end);
    assert.match(
      chunk,
      /revoke all on function public\.consume_sms_units\(uuid, integer\)\s+from public, anon, authenticated/
    );
    assert.doesNotMatch(chunk, /to authenticated, service_role/);
    assert.match(chunk, /billing_status = 'beta'/);
  });

  it("keeps a seat-removal credit on the draft invoice total", () => {
    const body = functionBody(actions, "_owner_next_invoice_line");
    assert.doesNotMatch(body, /greatest\(v_sum, 0\)/);
  });

  it("caps reserve_notify_send SMS units and keeps the desk grant", () => {
    const body = functionBody(actions, "reserve_notify_send");
    assert.match(body, /least\(greatest\(coalesce\(p_units, 1\), 1\), 30\)/);
    const grants = actions.slice(actions.indexOf("function public.reserve_notify_send"));
    assert.match(
      grants,
      /grant execute on function public\.reserve_notify_send\(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean\)\s+to authenticated, service_role/
    );
  });

  it("rolls allowances from the pinned package version", () => {
    const roll = fs.readFileSync(path.join(__dirname, "../docs/supabase/package_period_rollover.sql"), "utf8");
    const body = functionBody(roll, "roll_package_periods");
    assert.match(body, /billing_package_versions/);
  });
});
