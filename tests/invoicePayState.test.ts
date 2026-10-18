/**
 * Invoice pay copy. Paid is a server status. No token, no Pay button. No /pay route.
 * Run: node --experimental-strip-types --test tests/invoicePayState.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoicePayState } from "../dashboard/src/lib/invoicePayState.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("invoicePayState", () => {
  it("shows Paid only when status is paid", () => {
    assert.equal(invoicePayState({ status: "paid" }).label, "Paid");
    assert.equal(invoicePayState({ status: "open" }).label, "Open");
    assert.notEqual(invoicePayState({ status: "open", returnedFromPay: true }).label, "Paid");
  });

  it("says Checking payment after a return until the webhook marks it paid", () => {
    const view = invoicePayState({
      status: "open",
      returnedFromPay: true,
      payLinkPath: "/api/billing/invoices/1/pay-link",
    });
    assert.equal(view.label, "Checking payment");
    assert.equal(view.showPayButton, false);
    assert.equal(invoicePayState({ status: "paid", returnedFromPay: true }).label, "Paid");
  });

  it("shows Pay only when a pay link exists and the account is not beta", () => {
    const hidden = invoicePayState({ status: "open", payLinkPath: null });
    assert.equal(hidden.showPayButton, false);
    assert.equal(hidden.payLinkPath, null);
    const beta = invoicePayState({
      status: "open",
      payLinkPath: "/api/billing/invoices/1/pay-link",
      beta: true,
    });
    assert.equal(beta.showPayButton, false);
    const ready = invoicePayState({ status: "open", payLinkPath: "/api/billing/invoices/1/pay-link" });
    assert.equal(ready.showPayButton, true);
    assert.equal(ready.payLinkPath, "/api/billing/invoices/1/pay-link");
    assert.equal(invoicePayState({ status: "paid", payLinkPath: "/api/billing/invoices/1/pay-link" }).showPayButton, false);
  });

  it("hides drafts", () => {
    assert.equal(invoicePayState({ status: "draft" }).hidden, true);
  });

  it("does not let the client set paid, and does not ship /pay", () => {
    const check = fs.readFileSync(
      path.join(root, "dashboard/src/components/plan/PaymentCheck.tsx"),
      "utf8",
    );
    assert.match(check, /router\.refresh/);
    assert.doesNotMatch(check, /status:\s*["']paid["']|setStatus\(|paid:\s*true/);
    const state = fs.readFileSync(path.join(root, "dashboard/src/lib/invoicePayState.ts"), "utf8");
    assert.doesNotMatch(state, /\/pay\/\$\{/);
    assert.doesNotMatch(state, /pay_token|payToken|credit_kes/);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/app/pay")), false);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/app/(desk)/pay")), false);
    const actions = fs.readFileSync(
      path.join(root, "dashboard/src/app/(desk)/settings/plan/planActions.ts"),
      "utf8",
    );
    assert.doesNotMatch(actions, /ok:\s*true/);
  });
});
