const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/invoiceActions.ts"));

const inv = (o = {}) => ({
  id: "i1",
  number: "SCL-2026-000042",
  status: "open",
  totalCents: 1800000,
  paidCents: 0,
  billingEmail: "billing@example.com",
  remindersPausedAt: null,
  ...o,
});

test("void / credit / resend / dispute gates", async () => {
  const {
    canVoidInvoice,
    canCreditNote,
    canResendInvoice,
    canDisputeInvoice,
    balanceKes,
    voidBlockedWhy,
    creditBlockedWhy,
  } = await load();
  assert.equal(canVoidInvoice(inv()), true);
  assert.equal(canVoidInvoice(inv({ status: "paid" })), false);
  assert.equal(canCreditNote(inv()), true);
  assert.equal(canCreditNote(inv({ paidCents: 1800000 })), false);
  assert.equal(canCreditNote(inv({ status: "draft" })), false);
  assert.equal(canResendInvoice(inv()), true);
  assert.equal(canResendInvoice(inv({ status: "draft", number: "Draft" })), false);
  assert.equal(canDisputeInvoice(inv()), true);
  assert.equal(balanceKes(inv()), 18000);
  assert.match(voidBlockedWhy(inv({ status: "paid" })) || "", /Paid/);
  assert.match(creditBlockedWhy(inv({ paidCents: 1800000 })) || "", /Nothing left/);
});

test("resend recipients: saved, typed, both, validation", async () => {
  const { resolveResendRecipients, isValidResendEmail } = await load();
  assert.equal(isValidResendEmail("a@b.co"), true);
  assert.equal(isValidResendEmail("nope"), false);
  const saved = resolveResendRecipients({
    savedEmail: "billing@example.com",
    typedEmail: "",
    mode: "saved",
  });
  assert.equal(saved.ok, true);
  if (saved.ok) assert.deepEqual(saved.to, ["billing@example.com"]);
  const typed = resolveResendRecipients({
    savedEmail: null,
    typedEmail: "Other@Example.com",
    mode: "typed",
  });
  assert.equal(typed.ok, true);
  if (typed.ok) assert.deepEqual(typed.to, ["other@example.com"]);
  const both = resolveResendRecipients({
    savedEmail: "billing@example.com",
    typedEmail: "other@example.com",
    mode: "both",
  });
  assert.equal(both.ok, true);
  if (both.ok) assert.deepEqual(both.to, ["billing@example.com", "other@example.com"]);
  const miss = resolveResendRecipients({ savedEmail: null, typedEmail: "", mode: "saved" });
  assert.equal(miss.ok, false);
});

test("s29 wires: UI actions, API, SQL, no fake success", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminInvoicesV2.tsx");
  assert.match(ui, /action: "credit_note"/);
  assert.match(ui, /action: "void"/);
  assert.match(ui, /action: "resend"/);
  assert.match(ui, /Resend invoice/);
  assert.match(ui, /Issue credit note/);
  assert.match(ui, /Mark disputed/);
  assert.match(ui, /\/api\/admin\/billing\/invoices\/\$\{it\.id\}\/actions/);
  assert.doesNotMatch(ui, /sautikit|twilio|prepaid|wallet/i);

  const api = read("dashboard/src/app/api/admin/billing/invoices/[id]/actions/route.ts");
  assert.match(api, /voidAdminInvoice|issueAdminCreditNote|resendAdminInvoice/);
  assert.match(api, /requireAdminOperatorWrite/);
  assert.match(api, /501/);

  const lib = read("dashboard/src/lib/adminInvoiceActions.ts");
  assert.match(lib, /admin_void_invoice/);
  assert.match(lib, /admin_issue_credit_note/);
  assert.match(lib, /isMissingInvoiceActionRpc/);
  assert.match(lib, /RPC_MISSING|invoice write path/);
  assert.match(lib, /sendOpsMail/);
  assert.doesNotMatch(lib, /ok:\s*true.*fake|verified:\s*true/);

  const sql = read("docs/supabase/admin_invoice_actions.sql");
  assert.match(sql, /admin_void_invoice/);
  assert.match(sql, /admin_issue_credit_note/);
  assert.match(sql, /admin_set_invoice_dispute/);
  assert.match(sql, /reminders_paused_at/);
  assert.match(sql, /reminders paused \(disputed\)/);
  assert.match(sql, /credit-note:/);
});

test("load includes billing email; invoicesView optional fields", () => {
  const ld = read("dashboard/src/lib/adminInvoicesV2Load.ts");
  assert.match(ld, /alert_email/);
  assert.match(ld, /billingEmail/);
  assert.match(ld, /reminders_paused_at/);
  const view = read("dashboard/src/lib/ops/invoicesView.ts");
  assert.match(view, /billingEmail\?/);
  assert.match(view, /remindersPausedAt\?/);
});
