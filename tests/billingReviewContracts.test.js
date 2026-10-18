/**
 * Pay-path contracts from the #784 review that this branch owns.
 * The #781 and #778 assertions stay on cursor/billing-review-tests-7822.
 * They read those branches with git show and are not this pull request.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("legacy billing mode and invoice freeze", () => {
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
