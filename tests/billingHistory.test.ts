/**
 * Billing list maps GET /api/billing/invoices. Pay follows the POST path only.
 * Run: node --experimental-strip-types --test tests/billingHistory.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kshCents, mapBillingHistory, nextPart, payLinkDestination, splitParts } from "../dashboard/src/lib/billingHistory.ts";

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

  it("lists due invoices before paid ones", () => {
    const rows = mapBillingHistory(
      { invoices: [{ ...open, id: "inv-0", status: "paid", pay_link_path: null }, open] },
      { fromPay: false },
    );
    assert.deepEqual(rows.map((row) => row.id), ["inv-1", "inv-0"]);
  });

  it("hides Pay during beta, while checking, and when the link is missing", () => {
    assert.equal(mapBillingHistory({ invoices: [open] }, { fromPay: false, beta: true })[0]?.payLabel, null);
    const checking = mapBillingHistory({ invoices: [open] }, { fromPay: true })[0];
    assert.equal(checking?.statusLabel, "Checking payment");
    assert.equal(checking?.payLabel, null);
    assert.equal(mapBillingHistory({ invoices: [{ ...open, pay_link_path: null }] }, { fromPay: false })[0]?.payLabel, null);
    assert.equal(mapBillingHistory({ invoices: [{ ...open, status: "draft" }] }, { fromPay: false }).length, 0);
  });

  it("keeps SCL- numbers as the invoice API sends them", () => {
    const rows = mapBillingHistory({ invoices: [open, { ...open, id: "inv-3", number: "SCL-2026-0007" }, { ...open, id: "inv-4", number: null }] }, { fromPay: false });
    assert.deepEqual(rows.map((row) => row.number), ["SCL-1042", "SCL-2026-0007", "Invoice"]);
  });

  it("names the received part of a split payment and pays the next part", () => {
    const split = { ...open, total_due: "KSh 300,000", amount_paid: "KSh 150,000", balance: "KSh 150,000" };
    const [row] = mapBillingHistory({ invoices: [split] }, { fromPay: false });
    assert.equal(row?.statusLabel, "Part 1 of 2 received");
    assert.equal(row?.payLabel, "Pay KSh 150,000");
    assert.equal(row?.totalLabel, "KSh 300,000");

    const unpaid = mapBillingHistory({ invoices: [{ ...open, total_due: "KSh 200,000", amount_paid: "KSh 0", balance: "KSh 200,000" }] }, { fromPay: false })[0];
    assert.equal(unpaid?.statusLabel, "Due by 9 Oct");
    assert.equal(unpaid?.payLabel, "Pay KSh 100,000");

    const uneven = mapBillingHistory({ invoices: [{ ...open, total_due: "KSh 300,001", amount_paid: "KSh 100,000.34" }] }, { fromPay: false })[0];
    assert.equal(uneven?.statusLabel, "Part 1 of 3 received");
    assert.equal(uneven?.payLabel, "Pay KSh 100,000.33");
  });

  it("splits like the pay page: at most KSh 150,000 a part, summing to the total", () => {
    assert.deepEqual(splitParts(15_000_000), [15_000_000]);
    assert.deepEqual(splitParts(30_000_100), [10_000_034, 10_000_033, 10_000_033]);
    assert.deepEqual(splitParts(0), []);
    assert.deepEqual(nextPart([15_000_000, 15_000_000], 15_000_000), { index: 2, count: 2, cents: 15_000_000 });
    assert.equal(nextPart([15_000_000, 15_000_000], 30_000_000), null);
  });

  it("shows what is still due after a partial payment on a single-part invoice", () => {
    const [row] = mapBillingHistory({ invoices: [{ ...open, amount_paid: "KSh 2,000", balance: "KSh 5,000" }] }, { fromPay: false });
    assert.equal(row?.statusLabel, "KSh 5,000 still due");
    assert.equal(row?.payLabel, "Pay KSh 5,000");
  });

  it("shows negative amounts as sent and never offers Pay when nothing is owed", () => {
    const credit = { ...open, id: "inv-5", total_due: "KSh -1,000", balance: "KSh 0" };
    const rows = mapBillingHistory({ invoices: [credit, open] }, { fromPay: false });
    assert.deepEqual(rows.map((row) => row.id), ["inv-1", "inv-5"]);
    assert.equal(rows[1]?.totalLabel, "KSh -1,000");
    assert.equal(rows[1]?.statusLabel, "Nothing due");
    assert.equal(rows[1]?.payLabel, null);
    assert.equal(rows[1]?.payLinkPath, null);
    const leading = mapBillingHistory({ invoices: [{ ...open, total_due: "-KSh 1,000" }] }, { fromPay: false })[0];
    assert.equal(leading?.payLabel, null);
    const cleared = mapBillingHistory({ invoices: [{ ...open, balance: "KSh 0" }] }, { fromPay: false })[0];
    assert.equal(cleared?.statusLabel, "Nothing due");
    assert.equal(cleared?.payLabel, null);
  });

  it("reads KSh amounts in either negative form", () => {
    assert.equal(kshCents("KSh 1,234.5"), 123_450);
    assert.equal(kshCents("KSh -1,000"), -100_000);
    assert.equal(kshCents("-KSh 1,000"), -100_000);
    assert.equal(kshCents("KSh 0"), 0);
    assert.equal(kshCents(""), null);
    assert.equal(kshCents("USD 5"), null);
  });

  it("labels void invoices without a due date or Pay", () => {
    const [row] = mapBillingHistory({ invoices: [{ ...open, status: "void", pay_link_path: null }] }, { fromPay: false });
    assert.equal(row?.statusLabel, "Void");
    assert.equal(row?.payLabel, null);
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
