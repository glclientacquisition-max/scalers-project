/**
 * Billing list maps GET /api/billing/invoices. Pay follows the POST path only.
 * Run: node --experimental-strip-types --test tests/billingHistory.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapBillingHistory, payLinkDestination } from "../dashboard/src/lib/billingHistory.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const open = {
  id: "inv-1",
  number: "SCL-1042",
  status: "open",
  due_at: "2026-10-09T00:00:00+03:00",
  total_due: "KSh 7,000",
  pay_link_path: "/api/billing/invoices/inv-1/pay-link",
  credits_applied: "KSh 1",
  tax_kes: "1120",
};

describe("billing history", () => {
  it("offers Pay KSh only when a pay link exists, and Paid only from status", () => {
    const rows = mapBillingHistory({ invoices: [open, { ...open, id: "inv-2", status: "paid", pay_link_path: null, total_due: "KSh 7,000" }] }, { fromPay: false });
    assert.equal(rows[0]?.payLabel, "Pay KSh 7,000");
    assert.equal(rows[0]?.payLinkPath, "/api/billing/invoices/inv-1/pay-link");
    assert.equal(rows[0]?.statusLabel, "Due by 9 Oct");
    assert.equal(rows[1]?.payLabel, null);
    assert.equal(rows[1]?.statusLabel, "Paid");
    assert.equal(JSON.stringify(rows).includes("credit"), false);
  });

  it("hides Pay during beta, while checking, and when the link is missing", () => {
    assert.equal(mapBillingHistory({ invoices: [open] }, { fromPay: false, beta: true })[0]?.payLabel, null);
    const checking = mapBillingHistory({ invoices: [open] }, { fromPay: true })[0];
    assert.equal(checking?.statusLabel, "Checking payment");
    assert.equal(checking?.payLabel, null);
    assert.equal(mapBillingHistory({ invoices: [{ ...open, pay_link_path: null }] }, { fromPay: false })[0]?.payLabel, null);
    assert.equal(mapBillingHistory({ invoices: [{ ...open, status: "draft" }] }, { fromPay: false }).length, 0);
  });

  it("follows only the pay path the POST returns", () => {
    assert.equal(payLinkDestination({ pay_path: "/pay/once" }).href, "/pay/once");
    assert.equal(payLinkDestination({ pay_path: null, reason: "Pay link already issued" }).reason, "Pay link already issued");
    assert.equal(payLinkDestination({ pay_path: null, reason: "This invoice cannot be paid here" }).reason, "This invoice cannot be paid here");
    assert.equal(payLinkDestination({ pay_path: "https://evil.example/pay/x" }).href, undefined);
    assert.equal(payLinkDestination({ pay_path: "/pay/../admin" }).reason, "Could not open the pay link.");
    assert.equal(payLinkDestination({ reason: "stack trace" }).reason, "Could not open the pay link.");
  });

  it("loads the list from the invoice API and never reads credit_kes", () => {
    const history = fs.readFileSync(path.join(root, "dashboard/src/components/plan/BillingHistory.tsx"), "utf8");
    const page = fs.readFileSync(path.join(root, "dashboard/src/app/(desk)/settings/billing/page.tsx"), "utf8");
    const load = fs.readFileSync(path.join(root, "dashboard/src/lib/ownerPlanLoad.ts"), "utf8");
    assert.match(history, /\/api\/billing\/invoices/);
    assert.match(history, /method:\s*"POST"/);
    assert.match(page, /BillingHistory/);
    assert.doesNotMatch(history, /credit_kes|localStorage|pay_token/);
    assert.doesNotMatch(page, /credit_kes|pay_token/);
    assert.match(load, /annual_price_kes/);
    assert.match(load, /spend_limit_share_percent/);
    assert.doesNotMatch(load, /credit_kes/);
  });
});
