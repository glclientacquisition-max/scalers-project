"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const copy = require("../dashboard/src/lib/adminBillingCopy.ts");
const errors = require("../dashboard/src/lib/adminErrors.ts");

const DETAIL = "dashboard/src/components/AdminBillingDetailPanel.tsx";
const MONEY = "dashboard/src/components/AdminShopMoneyPanel.tsx";
const LIST = "dashboard/src/components/AdminBillingListPanel.tsx";
const PACKAGES = "dashboard/src/components/AdminPackagesPanel.tsx";
const BILLING_REDIRECT = "dashboard/src/app/admin/(console)/billing/[tenantId]/page.tsx";
const BILLING_API = "dashboard/src/app/api/admin/billing/route.ts";
const PACKAGES_API = "dashboard/src/app/api/admin/packages/route.ts";

describe("admin billing: readable errors", () => {
  it("never shows [object Object] for a database error object", () => {
    const pg = { message: 'column reference "minutes_included" is ambiguous', code: "42702", details: null, hint: null };
    assert.equal(errors.adminFacingError(pg, "That didn't save."), "That didn't save.");
    assert.equal(errors.adminFacingError({ foo: 1 }, "That didn't save."), "That didn't save.");
    assert.notEqual(errors.adminFacingError(pg), "[object Object]");
  });

  it("keeps a deliberate raise exception message", () => {
    assert.equal(errors.adminFacingError({ message: "package not found", code: "P0001" }, "x"), "Package not found");
    assert.equal(errors.adminFacingError({ message: "duplicate key value", code: "23505" }, "x"), "x");
    assert.equal(errors.adminFacingError(new Error("Pick a package."), "x"), "Pick a package.");
  });

  it("client error text is always a string", () => {
    assert.equal(copy.requestErrorText({ error: "Pick a business first." }), "Pick a business first.");
    assert.equal(copy.requestErrorText({ error: { message: "x" } }), "That didn't save. Nothing changed. Try again.");
    assert.equal(copy.requestErrorText({ error: "[object Object]" }, "Nope."), "Nope.");
    assert.equal(copy.requestErrorText(null, "Nope."), "Nope.");
  });

  it("billing API speaks plainly and uses a save fallback", () => {
    const api = read(BILLING_API);
    assert.doesNotMatch(api, /business_id required|off\|soft\|hard|unknown action|min 3 chars/);
    assert.match(api, /adminFacingError\(err, SAVE_FAILED\)/);
    const money = read(MONEY);
    const resolve = read("dashboard/src/components/CheckoutReviewResolve.tsx");
    assert.doesNotMatch(money, /json\.error \|\|/);
    assert.doesNotMatch(resolve, /json\.error \|\|/);
    assert.match(money, /requestErrorText\(json\)/);
    assert.match(resolve, /requestErrorText\(json\)/);
  });
});

describe("admin billing: no typed actor", () => {
  it("drops the Ops actor box and never posts an actor", () => {
    const detail = read(DETAIL);
    assert.doesNotMatch(detail, /Ops actor|scalers\.ops\.actor|sessionStorage|actor:/);
  });
});

describe("admin billing: placeholder numbers", () => {
  it("hides pending:<id> and empty numbers", () => {
    assert.equal(copy.numberLabel("pending:51a6c7c6-72f9-43f7-b6c2-942960029cca"), "Waiting for a number");
    assert.equal(copy.numberLabel(""), "Waiting for a number");
    assert.equal(copy.numberLabel(null), "Waiting for a number");
    assert.equal(copy.numberLabel("+254 711 082 000"), "+254 711 082 000");
    assert.equal(copy.searchableNumber("pending:abc"), "");
    assert.equal(copy.searchableNumber("+254711082000"), "+254711082000");
    const list = read(LIST);
    assert.match(list, /numberLabel\(row\.sautikit_virtual_number\)/);
    assert.doesNotMatch(list, /\{row\.sautikit_virtual_number\}/);
  });
});

describe("admin billing: charging sheet label", () => {
  it("does not offer to stop charging a free business", () => {
    assert.deepEqual(copy.chargingAction("off", "off"), { label: "No change", disabled: true, needsConfirm: false });
    assert.equal(copy.chargingAction("off", "soft").label, "Start charging");
    assert.equal(copy.chargingAction("off", "soft").needsConfirm, true);
    assert.equal(copy.chargingAction("soft", "off").label, "Stop charging");
    assert.equal(copy.chargingAction("soft", "hard").label, "Switch to Charging · Block at cap");
    const money = read(MONEY);
    assert.doesNotMatch(money, /mode === "off" \? "Stop charging"/);
    assert.match(money, /chargingStep\.label/);
  });
});

describe("admin billing: plain history", () => {
  it("names package changes before and after with the reason", () => {
    const line = copy.billingAuditDetail({
      action: "assign_package",
      actor: "desk",
      detail: { before: { packageName: "Starter", period: "month" }, after: { packageName: "Growth", period: "month" }, reason: "upgrade" },
    });
    assert.equal(line, "Starter / month → Growth / month · upgrade");
    assert.equal(
      copy.billingAuditDetail({ action: "assign_package", actor: "desk", detail: { before: null, after: { packageName: "Growth", period: "year" } } }),
      "None → Growth / year",
    );
    // SQL snapshot shape (assign/unassign_tenant_package detail.before / detail.after).
    const snap = (sku, name, status = "active") => ({ package_sku: sku, package_name: name, period: status === "active" ? "month" : null, period_start: "2026-10-01T00:00:00+03:00", period_end: "2026-11-01T00:00:00+03:00", status });
    assert.equal(
      copy.billingAuditDetail({ action: "assign_package", actor: "alvin", detail: { before: snap(null, null, "none"), after: snap("starter", "Starter"), note: "first" } }),
      "None → Starter / month · first",
    );
    assert.equal(
      copy.billingAuditDetail({ action: "unassign_package", actor: "alvin", detail: { before: snap("growth", "Growth"), after: snap(null, null, "none"), note: "closed" } }),
      "Growth / month → None · closed",
    );
    assert.equal(
      copy.billingAuditDetail({ action: "set_on_demand_usage", actor: "owner@x", detail: { before: { on_demand_usage_enabled: false }, after: { on_demand_usage_enabled: true } } }),
      "On-demand on",
    );
    assert.equal(copy.billingAuditDetail({ action: "set_billing_mode", actor: "x", detail: { mode: "soft", note: "pilot" } }), "Now Charging · On-demand · pilot");
    assert.equal(copy.billingAuditDetail({ action: "grant_package_minutes", actor: "x", detail: { minutes_granted: 60, note: "comp" } }), "+60 min · comp");
    assert.equal(copy.ledgerKindLabel("call_charge"), "Call charge");
    assert.equal(copy.ledgerKindLabel("some_new_kind"), "Some new kind");
  });

  it("history rows show a label, the change, the EAT stamp and who did it; never a raw code", () => {
    const lib = read("dashboard/src/lib/adminBilling.ts");
    assert.match(lib, /title: actionLabel\(row\.action\)/);
    assert.match(lib, /when: eatStamp\(row\.created_at\)/);
    assert.match(lib, /actor: row\.actor/);
    const money = read(MONEY);
    assert.doesNotMatch(money, /entry\.kind|entry\.summary|toLocaleString\("en-KE"\)\} ·/);
    assert.match(money, /entry\.when, entry\.actor/);
  });
});

describe("admin billing: list queue", () => {
  it("uses segmented filters, wait chips, and shop money links", () => {
    const list = read(LIST);
    const chips = read("dashboard/src/components/AdminBillingFilterChips.tsx");
    assert.match(list, /<Segmented/);
    assert.match(list, /AdminBillingFilterChips/);
    assert.match(chips, /No plan/);
    assert.match(chips, /rounded-md/);
    assert.doesNotMatch(chips, /hint/);
    assert.doesNotMatch(list, /MixBar|Commercial mix|Pick a queue|Needs attention|Catalog/);
    assert.match(list, /\/admin\/businesses\/\$\{.*\}\?money=1/);
    assert.match(list, /href="\/admin\/packages"/);
    assert.match(list, /Plans/);
    assert.match(list, /Reviews/);
    assert.match(list, /Open invoices|openInvoiceKesLabel/);
    assert.match(list, /Pagination/);
    assert.doesNotMatch(list, /admin\/billing\/\$\{/);
  });
});

describe("admin billing: one assign path", () => {
  it("Packages no longer assigns; rows open shop Money", () => {
    const panel = read(PACKAGES);
    const api = read(PACKAGES_API);
    assert.doesNotMatch(api, /action === "assign"/);
    assert.doesNotMatch(api, /assignBusinessPackage/);
    assert.doesNotMatch(panel, /action: "assign"|openAssign|sheet === "assign"/);
    assert.doesNotMatch(panel, /label: "Shops"/);
    assert.match(panel, /\/admin\/businesses\/\$\{tenantId\}\?money=1/);
    assert.match(read(BILLING_API), /action === "assign_package"/);
    assert.match(read(BILLING_API), /action === "unassign_package"/);
    assert.match(read(BILLING_REDIRECT), /redirect\(/);
    const money = read(MONEY);
    assert.match(money, /unassign_package/);
    assert.match(money, /Remove package/);
  });
});

describe("admin billing: Change package confirm", () => {
  const now = new Date("2026-10-09T18:30:00Z"); // 9 Oct 21:30 EAT
  const starter = { name: "Starter", minutes: 300, sms: 200, email: 100 };
  const growth = { name: "Growth", minutes: 800, sms: 500, email: 250 };

  it("says it applies now, restarts the period, replaces allowances and clears granted minutes", () => {
    const c = copy.packageChange({
      current: { ...starter, period: "month" },
      next: growth,
      period: "month",
      minutesIncluded: 360,
      minutesUsed: 229,
      now,
    });
    assert.equal(c.title, "Change to Growth?");
    assert.equal(c.confirmLabel, "Change package");
    const text = c.lines.join("\n");
    assert.match(text, /Applies now\. The period restarts and runs 1 Oct 2026 to 1 Nov 2026\./);
    assert.match(text, /Included becomes Growth's: 800 min, 500 SMS, 250 email\./);
    assert.match(text, /Clears the 60 granted minutes on top of Starter\./);
    assert.match(text, /229 minutes already used still count\./);
  });

  it("warns when used minutes already pass the new package", () => {
    const c = copy.packageChange({ current: { ...growth, period: "month" }, next: starter, period: "year", minutesIncluded: 800, minutesUsed: 420, now });
    const text = c.lines.join("\n");
    assert.match(text, /runs 1 Oct 2026 to 1 Oct 2027/);
    assert.match(text, /Clears any minutes granted this period\./);
    assert.match(text, /That is more than Starter includes\./);
  });

  it("first assignment reads as Assign", () => {
    const c = copy.packageChange({ current: null, next: growth, period: "month", minutesIncluded: 0, minutesUsed: 0, now });
    assert.equal(c.title, "Assign Growth?");
    assert.equal(c.confirmLabel, "Assign package");
  });

  it("period window uses Nairobi time at a month edge", () => {
    // 31 Oct 22:00 UTC is 1 Nov 01:00 EAT.
    assert.deepEqual(copy.periodWindow("month", new Date("2026-10-31T22:00:00Z")), { start: "1 Nov 2026", end: "1 Dec 2026" });
  });

  it("the package sheet goes through a ConfirmSheet before assign_package", () => {
    const money = read(MONEY);
    assert.match(money, /packageConfirmOpen/);
    assert.match(money, /Review change/);
    assert.match(money, /change\?\.lines\.map/);
    const sheetFooter = money.slice(money.indexOf('title="Package"'), money.indexOf('title="Plan"'));
    assert.doesNotMatch(sheetFooter, /action: "assign_package"/);
    assert.doesNotMatch(money, /<dialog|role="dialog"|window\.confirm/);
  });
});

describe("admin billing: checkout review", () => {
  it("resolves from a confirm with a typed reason and the session actor", () => {
    const resolve = read("dashboard/src/components/CheckoutReviewResolve.tsx");
    const money = read(MONEY);
    const api = read(BILLING_API);
    assert.match(money, /CheckoutReviewResolve/);
    assert.match(read(LIST), /CheckoutReviewResolve/);
    assert.match(resolve, /resolve_checkout_review/);
    assert.match(resolve, /title="Resolve checkout review"/);
    assert.match(resolve, /A new checkout stays closed until you book this reading or confirm nothing was collected\./);
    assert.match(resolve, /Book collected amount/);
    assert.match(resolve, /Nothing collected/);
    assert.match(resolve, /Confirm nothing collected/);
    assert.match(resolve, /Books the reading up to what is still due\. Anything over that is a credit\./);
    assert.match(resolve, /Leaves the books as they are\. A new checkout can then start for what is still due\./);
    assert.match(resolve, /choice: reviewChoice/);
    assert.match(resolve, /confirmDisabled=\{!reviewChoice \|\| reviewNote\.trim\(\)\.length < 3\}/);
    assert.doesNotMatch(resolve, /This does not move money/);
    assert.doesNotMatch(resolve, /actor:/);
    assert.match(api, /action === "resolve_checkout_review"/);
    assert.match(api, /choice !== "book" && choice !== "nothing"/);
    assert.match(api, /bookTotalForResolve/);
    assert.match(api, /paymentsClosed/);
    assert.match(api, /adminActorName\(\)/);
    assert.match(api, /resolveCheckoutTotalReview/);
    assert.doesNotMatch(api, /body\.actor/);
  });
});

describe("admin billing copy: no vendor names", () => {
  it("copy module and panels name no supplier or infra", () => {
    for (const rel of [
      "dashboard/src/lib/adminBillingCopy.ts",
      "dashboard/src/lib/adminPayCopy.ts",
      DETAIL,
      LIST,
      PACKAGES,
      MONEY,
      "dashboard/src/components/CheckoutReviewResolve.tsx",
      "dashboard/src/components/AdminInvoiceList.tsx",
      "dashboard/src/components/AdminInvoiceDetail.tsx",
      "dashboard/src/components/AdminPaymentsStatus.tsx",
    ]) {
      const src = read(rel).replace(/sautikit_virtual_number/g, "");
      assert.doesNotMatch(src, errors.VENDOR_OR_INFRA_PATTERN, rel);
    }
  });
});
