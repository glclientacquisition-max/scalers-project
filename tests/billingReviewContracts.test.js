/**
 * The review checks that belong on owner billing actions.
 * Payment-provider, editor, and invoice-freeze checks stay on the review branch.
 * These read the files in this checkout.
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
