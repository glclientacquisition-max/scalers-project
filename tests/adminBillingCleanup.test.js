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
const LIST = "dashboard/src/components/AdminBillingListPanel.tsx";
const PACKAGES = "dashboard/src/components/AdminPackagesPanel.tsx";
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
    const detail = read(DETAIL);
    assert.doesNotMatch(detail, /json\.error \|\|/);
    assert.match(detail, /requestErrorText\(json\)/);
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
    assert.match(list, /numberLabel\(r\.sautikit_virtual_number\)/);
    assert.doesNotMatch(list, /\{r\.sautikit_virtual_number\}/);
  });
});

describe("admin billing: charging sheet label", () => {
  it("does not offer to stop charging a free business", () => {
    assert.deepEqual(copy.chargingAction("off", "off"), { label: "No change", disabled: true, needsConfirm: false });
    assert.equal(copy.chargingAction("off", "soft").label, "Start charging");
    assert.equal(copy.chargingAction("off", "soft").needsConfirm, true);
    assert.equal(copy.chargingAction("soft", "off").label, "Stop charging");
    assert.equal(copy.chargingAction("soft", "hard").label, "Switch to On-demand hard");
    const detail = read(DETAIL);
    assert.doesNotMatch(detail, /mode === "off" \? "Stop charging"/);
    assert.match(detail, /chargingStep\.label/);
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
    assert.equal(copy.billingAuditDetail({ action: "set_billing_mode", actor: "x", detail: { mode: "soft", note: "pilot" } }), "Now On-demand soft · pilot");
    assert.equal(copy.billingAuditDetail({ action: "grant_package_minutes", actor: "x", detail: { minutes_granted: 60, note: "comp" } }), "+60 min · comp");
    assert.equal(copy.ledgerKindLabel("call_charge"), "Call charge");
    assert.equal(copy.ledgerKindLabel("some_new_kind"), "Some new kind");
  });

  it("history rows show a label, the change, the EAT stamp and who did it; never a raw code", () => {
    const lib = read("dashboard/src/lib/adminBilling.ts");
    assert.match(lib, /title: actionLabel\(row\.action\)/);
    assert.match(lib, /when: eatStamp\(row\.created_at\)/);
    assert.match(lib, /actor: row\.actor/);
    const detail = read(DETAIL);
    assert.doesNotMatch(detail, /entry\.kind|entry\.summary|toLocaleString\("en-KE"\)\} ·/);
    assert.match(detail, /entry\.when, entry\.actor/);
  });
});

describe("admin billing: list at 390", () => {
  it("shows rows as a list below sm and the table from sm up", () => {
    const list = read(LIST);
    assert.match(list, /sm:hidden/);
    assert.match(list, /hidden overflow-x-auto sm:block/);
    assert.match(list, /<ListRow/);
    assert.match(list, /href="\/admin\/packages"/);
    assert.doesNotMatch(list, /Edit SKUs|Observe every client/);
  });
});

describe("admin billing: one assign path", () => {
  it("Packages no longer assigns; rows open the business's Billing page", () => {
    const panel = read(PACKAGES);
    const api = read(PACKAGES_API);
    assert.doesNotMatch(api, /action === "assign"/);
    assert.doesNotMatch(api, /assignBusinessPackage/);
    assert.doesNotMatch(panel, /action: "assign"|openAssign|sheet === "assign"/);
    assert.match(panel, /\/admin\/billing\/\$\{tenantId\}/);
    assert.match(read(BILLING_API), /action === "assign_package"/);
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
    const detail = read(DETAIL);
    assert.match(detail, /packageConfirmOpen/);
    assert.match(detail, /Review change/);
    assert.match(detail, /change\?\.lines\.map/);
    const sheetFooter = detail.slice(detail.indexOf('title="Package"'), detail.indexOf('title="Charging"'));
    assert.doesNotMatch(sheetFooter, /action: "assign_package"/);
    assert.doesNotMatch(detail, /<dialog|role="dialog"|window\.confirm/);
  });
});

describe("admin billing copy: no vendor names", () => {
  it("copy module and panels name no supplier or infra", () => {
    for (const rel of ["dashboard/src/lib/adminBillingCopy.ts", DETAIL, LIST, PACKAGES]) {
      const src = read(rel).replace(/sautikit_virtual_number/g, "");
      assert.doesNotMatch(src, errors.VENDOR_OR_INFRA_PATTERN, rel);
    }
  });
});
