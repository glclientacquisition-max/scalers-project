import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as pay from "../dashboard/src/lib/payments.ts";
import * as rules from "../dashboard/src/lib/policyRules.ts";
import {
  applyStructuredPolicies,
  businessPoliciesForStorage,
  formatPoliciesForCompiler,
  normalizeBusinessPolicies,
} from "../dashboard/src/lib/businessPolicies.ts";

const root = path.resolve(import.meta.dirname, "..");
const SQL = fs.readFileSync(path.join(root, "supabase/migrations/20261012090000_payments_policies_v2.sql"), "utf8");

test("SQL payments_valid lists every method and timing in the taxonomy", () => {
  for (const m of pay.PAYMENT_METHODS) assert.ok(SQL.includes(`'${m.id}'`), m.id);
  for (const t of pay.PAYMENT_TIMING) assert.ok(SQL.includes(`'${t.id}'`), t.id);
  for (const t of rules.POLICY_TOPICS) assert.ok(SQL.includes(`'${t.id}'`), t.id);
});

test("Kenyan numbers normalise to E.164", () => {
  assert.equal(pay.kenyanMobileE164("0712 345 678"), "+254712345678");
  assert.equal(pay.kenyanMobileE164("0112345678"), "+254112345678");
  assert.equal(pay.kenyanMobileE164("+254 712-345-678"), "+254712345678");
  assert.equal(pay.kenyanMobileE164("254712345678"), "+254712345678");
  assert.equal(pay.kenyanMobileE164("712345678"), "+254712345678");
  assert.equal(pay.kenyanMobileE164("0212345678"), null);
  assert.equal(pay.kenyanMobileE164("12345"), null);
  assert.equal(pay.kenyanMobileDisplay("+254712345678"), "0712 345 678");
});

test("each method needs its own fields", () => {
  const base = { ...pay.emptyPayments(), methods: ["pochi", "mpesa_send", "airtel", "bank"] as pay.PaymentMethod[] };
  const e = pay.validatePayments({ ...base, pochi: { phone: "071" }, mpesa_send: { phone: "", name: null }, airtel: { till: null, phone: null }, bank: { bank_name: "", account_name: "", account_no: "12" } });
  assert.ok(e.pochi_phone && e.send_phone && e.airtel && e.bank_name && e.bank_account_name && e.bank_account_no);
  const good = pay.cleanPayments({
    ...base,
    pochi: { phone: "0712 345 678" },
    mpesa_send: { phone: "0722000111", name: "Jane" },
    airtel: { till: "1234", phone: null },
    bank: { bank_name: "Equity Bank", account_name: "Aris Ltd", account_no: "0123 4567 8901" },
  });
  assert.deepEqual(pay.validatePayments(good), {});
  assert.equal(good.pochi!.phone, "+254712345678");
  assert.equal(good.bank!.account_no, "012345678901");
});

test("several timings, deposit and note are spoken from the fields", () => {
  const p = pay.cleanPayments({
    ...pay.emptyPayments(),
    methods: ["mpesa_till", "pochi", "cash"],
    mpesa_till: "123456",
    pochi: { phone: "0712345678" },
    timings: ["on_delivery", "before_delivery", "deposit_then_balance"],
    deposit_percent: 30,
    note: "Send the M-Pesa message on WhatsApp",
  });
  assert.deepEqual(p.timings, ["before_delivery", "on_delivery", "deposit_then_balance"]);
  assert.equal(
    pay.paymentsSentence(p),
    "You can pay by M-Pesa Buy Goods Till 123456, Pochi la Biashara on 0712 345 678 or cash. Customers pay before delivery, on delivery or a 30% deposit first, then the balance. Send the M-Pesa message on WhatsApp.",
  );
  const pb = pay.cleanPayments({ ...pay.emptyPayments(), methods: ["mpesa_paybill"], mpesa_paybill: { business_no: "247247", account_mode: "customer_name", account: "ignored" } });
  assert.equal(pb.mpesa_paybill!.account, null);
  assert.match(pay.paymentsSentence(pb), /Paybill 247247, with your name as the account/);
});

test("deposit needs Deposit, then balance", () => {
  const e = pay.validatePayments({ ...pay.emptyPayments(), timings: ["on_delivery"], deposit_percent: 30 });
  assert.ok(e.deposit_percent);
});

test("v1 payments read as v2 without losing anything", () => {
  const v2 = pay.normalizePayments({ methods: ["mpesa_paybill", "cash"], mpesa_paybill: { business_no: "542542", account: "your name" }, timing: "on_delivery", deposit_percent: 40, source: "owner", confirmed: true })!;
  assert.deepEqual(v2.timings, ["on_delivery", "deposit_then_balance"]);
  assert.equal(v2.mpesa_paybill!.account_mode, "customer_name");
  assert.equal(v2.deposit_percent, 40);
});

test("parse reads Pochi and Send Money numbers", () => {
  const p = pay.parsePaymentsText("Pochi la biashara 0712 345 678 or send money to 0722 111 222. Cash on delivery.")!;
  assert.deepEqual(p.methods, ["pochi", "mpesa_send", "cash"]);
  assert.equal(p.pochi!.phone, "+254712345678");
  assert.equal(p.mpesa_send!.phone, "+254722111222");
  assert.deepEqual(p.timings, ["on_delivery"]);
});

test("BUG: a save of another section no longer drops typed payments or rules", () => {
  const stored = {
    payment: "old",
    payments: { version: 2, methods: ["cash"], timings: ["on_delivery"], source: "owner", confirmed: true },
    rules: { returns: { mode: "exchange", days: 7, conditions: ["unused"], note: null } },
    extra: { "Minimum order": "KSh 500" },
    field_meta: { x: 1 },
  };
  const round = businessPoliciesForStorage(normalizeBusinessPolicies(stored));
  assert.ok(round.payments, "payments kept");
  assert.ok(round.rules, "rules kept");
  assert.deepEqual(round.extra, stored.extra);
  assert.deepEqual(round.field_meta, stored.field_meta);
  assert.equal((round as { passthrough?: unknown }).passthrough, undefined);
});

test("Policies save generates the spoken text from payments and rules", () => {
  const p = normalizeBusinessPolicies({
    payment: "M-Pesa",
    payments: { version: 2, methods: ["mpesa_till"], mpesa_till: "123456", timings: ["on_delivery"], source: "owner", confirmed: true },
    rules: {
      returns: { mode: "refund_or_exchange", days: 7, conditions: ["unused", "receipt"] },
      delivery: { mode: "deliver", fee_mode: "flat", fee_ksh: 200, speed: "same_day", cutoff: "14:00", areas: "Nairobi CBD" },
      cancellation: { notice_hours: 24, fee: "deposit_kept" },
      no_show: { wait_minutes: 15, charge: "callout", fee_ksh: 500 },
    },
  });
  const res = applyStructuredPolicies(p);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.policies.payment, "You can pay by M-Pesa Buy Goods Till 123456. Customers pay on delivery.");
  assert.equal(res.policies.returns, "We refund or exchange items within 7 days if unused and with the receipt or M-Pesa message.");
  assert.equal(res.policies.delivery, "We deliver to Nairobi CBD the same day for orders before 2pm. Delivery costs KSh 200.");
  assert.match(res.policies.cancellation, /up to a day before\. After that, the deposit is kept\. We wait 15 minutes .* KSh 500 call-out fee/);
  assert.deepEqual(res.policies.provenance!.payment, { source: "owner", confirmed: true });
  const compiled = formatPoliciesForCompiler(res.policies);
  assert.match(compiled, /Payment: You can pay by M-Pesa Buy Goods Till 123456/);
  assert.match(compiled, /Returns: We refund or exchange/);
});

test("unconfirmed parsed payments keep the old text until the owner confirms", () => {
  const p = normalizeBusinessPolicies({ payment: "till 123456", payments: pay.parsePaymentsText("till 123456") });
  const res = applyStructuredPolicies(p);
  assert.ok(res.ok && res.policies.payment === "till 123456");
});

test("invalid rule or payment blocks the save with field errors", () => {
  const p = normalizeBusinessPolicies({
    payments: { version: 2, methods: ["pochi"], pochi: { phone: "123" }, source: "owner", confirmed: true },
    rules: { delivery: { mode: "deliver", fee_mode: "flat", fee_ksh: null } },
  });
  const res = applyStructuredPolicies(p);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.ok(res.fields.pochi_phone);
  assert.ok(res.fields["rules.delivery.fee_ksh"]);
});

test("rule sentences", () => {
  assert.equal(rules.returnsSentence({ mode: "none", days: null, conditions: [], note: "Custom prints are final" }), "We do not take returns. Custom prints are final.");
  assert.equal(rules.deliverySentence({ ...(rules.emptyRule("delivery") as rules.DeliveryRule), mode: "pickup_only" }), "We do not deliver. Customers collect from us.");
  assert.equal(rules.bookingChangesSentence({ allowed: true, notice_hours: 6, note: null }), "Customers can move a booking up to 6 hours before.");
  assert.equal(rules.warrantySentence({ months: 12, covers: ["workmanship", "parts"], note: null }), "We give a 1 year warranty on our workmanship and parts we supply.");
  assert.deepEqual(rules.topicsFor("home_services").slice(0, 3), ["cancellation", "booking_changes", "no_show"]);
});

test("merged booking line (cancel + move + late, each with a note) is kept whole, never cut at 500", () => {
  const n = `${"Please read our notes carefully ".repeat(4).trim()} end.`;
  const r = rules.normalizeRules({ cancellation: { notice_hours: 24, fee: "none", note: n }, booking_changes: { allowed: true, notice_hours: 6, note: n }, no_show: { wait_minutes: 15, charge: "none", note: n } });
  const text = rules.policyTextFromRules(r).cancellation!;
  assert.ok(text.length > 500, String(text.length));
  assert.ok(text.endsWith("end."));
  const saved = applyStructuredPolicies({ ...normalizeBusinessPolicies({}), rules: r });
  assert.ok(saved.ok && saved.policies.cancellation === text);
  assert.equal(rules.joinWholeSentences(["One two.", "Three four five."], 12), "One two.");
});
