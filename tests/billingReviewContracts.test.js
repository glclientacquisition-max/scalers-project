/**
 * Review contracts for #781 and #778. The SQL is read from those branches
 * with git show. Nothing here is applied.
 * These assert the billing rules that must hold before enforcement is turned on.
 * They fail on the branches under review.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ACTIONS = "origin/cursor/owner-billing-actions-5c64";
const EDITOR = "origin/cursor/admin-package-versions-b52e";

function gitShow(rev, file) {
  return execFileSync("git", ["show", `${rev}:${file}`], { encoding: "utf8" });
}

function functionBody(sql, name) {
  const marker = `function public.${name}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `unterminated ${name}`);
  return sql.slice(start, end);
}

describe("owner billing actions SQL", () => {
  const sql = gitShow(ACTIONS, "docs/supabase/owner_billing_actions.sql");

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
    assert.doesNotMatch(body, /from public\.billing_rate_card/);
  });

  it("disables the editor freeze while backfilling extra_seat_monthly_kes", () => {
    const editor = gitShow(EDITOR, "docs/supabase/package_version_editor.sql");
    const freeze = functionBody(editor, "billing_package_versions_freeze");
    assert.match(freeze, /extra_seat_monthly_kes/);
    assert.match(freeze, /published package version is frozen/);
    const at = sql.indexOf("set extra_seat_monthly_kes = 500");
    assert.ok(at > 0);
    const window = sql.slice(Math.max(0, at - 800), at + 500);
    assert.match(window, /disable trigger\s+billing_package_versions_freeze/i);
  });
});

describe("package version editor SQL", () => {
  const sql = gitShow(EDITOR, "docs/supabase/package_version_editor.sql");

  it("refuses billing_status beta unless enforcement is off", () => {
    const body = functionBody(sql, "admin_set_tenant_billing_mode");
    assert.match(
      body,
      /if p_billing_status = 'beta' and p_enforcement is distinct from 'off' then\s+raise exception/
    );
  });
});

describe("member wallet debit and period roll", () => {
  const actions = gitShow(ACTIONS, "docs/supabase/owner_billing_actions.sql");

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

  it("rolls allowances from the pinned package version", () => {
    const roll = fs.readFileSync(path.join(__dirname, "../docs/supabase/package_period_rollover.sql"), "utf8");
    const body = functionBody(roll, "roll_package_periods");
    assert.match(body, /billing_package_versions/);
  });
});

describe("legacy billing mode and invoice freeze", () => {
  it("refuses to turn enforcement on while billing_status stays beta", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/wallet_security_beta.sql"), "utf8");
    const body = functionBody(sql, "set_tenant_billing_mode");
    assert.match(body, /billing_status/);
    assert.match(body, /tenant_subscriptions/);
  });

  it("does not let a draft update occupy the next invoice number", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/billing_data_layer.sql"), "utf8");
    const body = functionBody(sql, "invoices_freeze");
    assert.match(body, /new\.invoice_number is not null|new\.status is distinct from 'draft'/);
  });

  it("revokes execute on payments_issue_receipt from public", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/invoice_documents.sql"), "utf8");
    const start = sql.indexOf("function public.payments_issue_receipt");
    const chunk = sql.slice(start, start + 1200);
    assert.match(chunk, /revoke all on function public\.payments_issue_receipt\(\) from public, anon, authenticated/);
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
