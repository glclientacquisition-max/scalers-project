/** Run: node --experimental-strip-types --test tests/setupFlow.test.ts */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogueForTenant,
  defaultDraft,
  emptyRow,
  faqsForTenant,
  firstInvalidStep,
  formatKenyaNumber,
  hoursSchedule,
  hoursText,
  normalizeKenyaPhone,
  numberPending,
  parseAmount,
  parseDraft,
  priceText,
  resumeStep,
  rowFromImport,
  splitLast,
  validateAlerts,
  validateCatalogue,
  validateFaqs,
  validateHours,
  validateStep,
  validateVoice,
  type CatalogueRow,
} from "../dashboard/src/lib/setupFlow.ts";

const row = (p: Partial<CatalogueRow>): CatalogueRow => ({ ...emptyRow(), ...p });

describe("prices", () => {
  it("parses positive whole and decimal shillings, rejects negatives, zero and text", () => {
    assert.equal(parseAmount("1,500"), 1500);
    assert.equal(parseAmount("KSh 250"), 250);
    assert.equal(parseAmount("99.50"), 99.5);
    for (const bad of ["-100", "0", "abc", "", "1e5", "12-3"]) assert.equal(parseAmount(bad), null, bad);
    assert.equal(parseAmount("20000000"), null);
  });
  it("writes the text callers hear", () => {
    assert.equal(priceText(row({ pricing_mode: "fixed", price: "1500" })), "KSh 1,500");
    assert.equal(priceText(row({ pricing_mode: "from", price: "300" })), "From KSh 300");
    assert.equal(priceText(row({ pricing_mode: "range", price: "200", price_max: "4000" })), "KSh 200-4,000");
    assert.equal(priceText(row({ pricing_mode: "ask" })), "Ask");
    assert.equal(priceText(row({ pricing_mode: "fixed", price: "-5" })), "");
  });
  it("maps imported price strings", () => {
    assert.deepEqual(
      [rowFromImport("a", "from 300"), rowFromImport("b", "200-400"), rowFromImport("c", "ask"), rowFromImport("d", "KSh 1,000")].map((r) => [r.pricing_mode, r.price, r.price_max]),
      [["from", "300", ""], ["range", "200", "400"], ["ask", "", ""], ["fixed", "1,000", ""]]
    );
  });
});

describe("catalogue step", () => {
  it("one priced item is enough for shops and home services", () => {
    assert.equal(validateCatalogue({ skipped: false, rows: [row({ name: "Charger", price: "500" })] }, "retail").ok, true);
    assert.equal(
      validateCatalogue({ skipped: false, rows: [row({ name: "Cleaning", pricing_mode: "ask", site_visit: "yes" })] }, "home_services").ok,
      true
    );
  });
  it("needs at least one item unless skipped; skip keeps the rows", () => {
    const empty = validateCatalogue({ skipped: false, rows: [] }, "retail");
    assert.equal(empty.ok, false);
    const skipped = validateCatalogue({ skipped: true, rows: [row({ name: "Kept" })] }, "retail");
    assert.equal(skipped.ok, true);
    assert.equal(skipped.ok && skipped.value.rows.length, 1);
  });
  it("flags each bad field by row", () => {
    const res = validateCatalogue(
      {
        skipped: false,
        rows: [
          row({ name: "", price: "100" }),
          row({ name: "Fix", pricing_mode: "range", price: "500", price_max: "400" }),
          row({ name: "fix", price: "-1" }),
        ],
      },
      "home_services"
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.ok(res.fields["rows.0.name"]);
    assert.match(res.fields["rows.1.price_max"], /more than/);
    assert.ok(res.fields["rows.1.site_visit"]);
    assert.match(res.fields["rows.2.name"], /already/);
    assert.ok(res.fields["rows.2.price"]);
  });
  it("drops blank rows", () => {
    const res = validateCatalogue({ skipped: false, rows: [row({ name: "A", price: "10" }), row({})] }, "retail");
    assert.equal(res.ok && res.value.rows.length, 1);
  });
  it("shapes rows for the tenant columns", () => {
    const step = { skipped: false, rows: [row({ name: "Deep clean", pricing_mode: "from", price: "3000", site_visit: "yes" })] };
    const home = catalogueForTenant(step, "home_services");
    assert.equal(home.products.length, 0);
    assert.equal(home.services[0].price_range, "From KSh 3,000");
    assert.equal(home.services[0].site_visit_required, true);
    const shop = catalogueForTenant({ skipped: false, rows: [row({ name: "Cable", price: "200" })] }, "retail");
    assert.equal(shop.products[0].price, "KSh 200");
    assert.equal(shop.products[0].price_mode, "fixed");
    assert.deepEqual(catalogueForTenant({ ...step, skipped: true }, "home_services").services, []);
  });
});

describe("hours step", () => {
  it("accepts split shifts and closed days, groups equal days", () => {
    const draft = defaultDraft();
    const days = { ...draft.hours.days };
    for (const k of ["mon", "tue", "wed", "thu", "fri"] as const) days[k] = { closed: false, shifts: [{ open: "08:00", close: "13:00" }, { open: "14:00", close: "18:00" }] };
    days.sat = { closed: false, shifts: [{ open: "09:00", close: "13:00" }] };
    assert.equal(validateHours({ skipped: false, days }).ok, true);
    assert.equal(hoursText(days), "Mon-Fri 08:00-13:00, 14:00-18:00; Sat 09:00-13:00; Sun closed");
    const sched = hoursSchedule(days, "Westlands");
    assert.deepEqual(sched.days.mon, { open: "08:00", close: "18:00", shifts: days.mon.shifts });
    assert.deepEqual(sched.days.sat, { open: "09:00", close: "13:00" });
    assert.equal(sched.days.sun, null);
  });
  it("rejects close before open, overlaps, empty open days, all closed", () => {
    const d = defaultDraft().hours.days;
    const bad = { ...d, mon: { closed: false, shifts: [{ open: "18:00", close: "09:00" }] }, tue: { closed: false, shifts: [{ open: "08:00", close: "13:00" }, { open: "12:00", close: "15:00" }] }, wed: { closed: false, shifts: [] } };
    const res = validateHours({ skipped: false, days: bad });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.fields["days.mon.0"], /after/);
      assert.match(res.fields["days.tue.1"], /Overlaps/);
      assert.ok(res.fields["days.wed"]);
    }
    const allClosed = Object.fromEntries(Object.keys(d).map((k) => [k, { closed: true, shifts: [] }])) as typeof d;
    assert.equal(validateHours({ skipped: false, days: allClosed }).ok, false);
    assert.equal(validateHours({ skipped: true, days: allClosed }).ok, true);
  });
  it("Add a break splits the last block with a gap", () => {
    assert.deepEqual(splitLast([{ open: "08:00", close: "18:00" }]), [{ open: "08:00", close: "12:30" }, { open: "13:30", close: "18:00" }]);
    assert.deepEqual(splitLast([{ open: "08:00", close: "10:00" }]), [{ open: "08:00", close: "10:00" }, { open: "11:00", close: "13:00" }]);
  });
});

describe("voice, faqs, alerts", () => {
  it("requires a receptionist name of 40 or fewer characters", () => {
    assert.equal(validateVoice({ agentName: " ", tone: "warm", handoff: "callback" }).ok, false);
    assert.equal(validateVoice({ agentName: "x".repeat(41), tone: "warm", handoff: "callback" }).ok, false);
    const ok = validateVoice({ agentName: " Wanjiru ", tone: "professional", handoff: "live_transfer" });
    assert.deepEqual(ok.ok && ok.value, { agentName: "Wanjiru", tone: "professional", handoff: "live_transfer" });
  });
  it("faqs need answers, no duplicates; only answered ones reach the tenant", () => {
    const res = validateFaqs({ skipped: false, items: [{ question: "Do you deliver?", answer: "" }, { question: "do you deliver?", answer: "Yes" }] });
    assert.equal(res.ok, false);
    assert.equal(validateFaqs({ skipped: false, items: [] }).ok, true);
    assert.deepEqual(faqsForTenant({ skipped: false, items: [{ question: "Q", answer: "A" }] }), [{ question: "Q", answer: "A", source: "owner", status: "confirmed" }]);
    assert.deepEqual(faqsForTenant({ skipped: true, items: [{ question: "Q", answer: "A" }] }), []);
  });
  it("alerts normalize +254 and block email alerts without an email", () => {
    const ok = validateAlerts({ phone: "0712 345 678", email: "Me@Biz.co.ke", whatsapp: true, sms: false, emailOn: true });
    assert.equal(ok.ok && ok.value.phone, "+254712345678");
    assert.equal(ok.ok && ok.value.email, "me@biz.co.ke");
    const noEmail = validateAlerts({ phone: "0712345678", email: "", whatsapp: true, sms: true, emailOn: true });
    assert.equal(noEmail.ok, false);
    assert.equal(validateAlerts({ phone: "", email: "", whatsapp: false, sms: false, emailOn: false }).ok, false);
    assert.equal(validateAlerts({ phone: "12345", email: "", whatsapp: true, sms: false, emailOn: false }).ok, false);
  });
  it("phone normalizer accepts 07/01/+254 mobiles only", () => {
    assert.equal(normalizeKenyaPhone("0112345678"), "+254112345678");
    assert.equal(normalizeKenyaPhone("+254 712 345 678"), "+254712345678");
    assert.equal(normalizeKenyaPhone("712345678"), "+254712345678");
    assert.equal(normalizeKenyaPhone("0201234567"), null);
    assert.equal(normalizeKenyaPhone("999999999999"), null);
  });
});

describe("draft and resume", () => {
  it("parseDraft clamps and ignores junk, seeds alerts from signup phone", () => {
    const d = parseDraft({ business: { vertical: "hack" }, catalogue: { rows: new Array(500).fill({ name: "x".repeat(999) }) }, evil: 1 }, { phone: "+254712345678", email: "a@b.co" });
    assert.equal(d.business.vertical, "retail");
    assert.equal(d.catalogue.rows.length, 200);
    assert.equal(d.catalogue.rows[0].name.length, 120);
    assert.equal(d.alerts.phone, "+254712345678");
    assert.equal(d.alerts.emailOn, true);
    assert.equal(parseDraft(null, { phone: "pending:abc" }).alerts.phone, "");
  });
  it("resumes at the furthest saved step and never skips ahead", () => {
    assert.equal(resumeStep(null, 3), 3);
    assert.equal(resumeStep("hours", 3), 2);
    assert.equal(resumeStep("alerts", 1), 1);
    assert.equal(resumeStep("nope", 99), 5);
  });
  it("firstInvalidStep points at what blocks finishing", () => {
    const d = defaultDraft({ phone: "0712345678" });
    assert.equal(firstInvalidStep(d), 1); // no catalogue yet
    d.catalogue = { skipped: true, rows: [] };
    assert.equal(firstInvalidStep(d), 3); // receptionist name missing
    d.voice.agentName = "Amani";
    assert.equal(firstInvalidStep(d), -1);
  });
  it("validateStep uses the draft's vertical for the catalogue", () => {
    const d = defaultDraft();
    d.business.vertical = "home_services";
    const step = { skipped: false, rows: [row({ name: "Cleaning", price: "100" })] };
    assert.equal(validateStep("catalogue", step, d).ok, false); // site visit unanswered
  });
});

describe("phone number", () => {
  it("knows a placeholder from a real number and formats for display", () => {
    assert.equal(numberPending("pending:uuid"), true);
    assert.equal(numberPending(""), true);
    assert.equal(numberPending("+254711082300"), false);
    assert.equal(formatKenyaNumber("+254711082300"), "+254 711 082 300");
  });
});
