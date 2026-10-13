/**
 * How customers pay, as typed facts. One shape for Settings, setup, the data checks and the
 * Business Assistant prompt. The spoken payment line is always generated from these fields
 * (paymentsSentence), never typed by hand, so what callers hear matches what is stored.
 *
 * Stored at tenants.business_policies.payments (version 2). Version 1 rows (single `timing`,
 * no phone numbers) are read through normalizePayments and rewritten as version 2 on save.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

type Opt = { id: string; label: string; detail?: string; speak?: string };

export type PaymentMethod =
  | "mpesa_till"
  | "mpesa_paybill"
  | "pochi"
  | "mpesa_send"
  | "airtel"
  | "bank"
  | "card"
  | "cash"
  | "cheque";
export type PaymentTiming =
  | "before_delivery"
  | "on_delivery"
  | "at_pickup"
  | "before_service"
  | "after_service"
  | "deposit_then_balance"
  | "on_account";
export type PaybillAccountMode = "fixed" | "customer_name" | "customer_phone" | "order_no";
export type CardWhere = "in_shop" | "on_delivery" | "payment_link";

export const PAYMENT_METHODS = taxonomy.payment_methods as Array<Opt & { id: PaymentMethod }>;
export const PAYMENT_TIMING = taxonomy.payment_timing as Array<Opt & { id: PaymentTiming }>;
export const PAYBILL_ACCOUNT_MODES = taxonomy.paybill_account_modes as Array<Opt & { id: PaybillAccountMode }>;
export const CARD_WHERE = taxonomy.card_where as Array<Opt & { id: CardWhere }>;
export const KENYA_BANKS = taxonomy.kenya_banks as string[];

export type Payments = {
  version: 2;
  methods: PaymentMethod[];
  /** Lipa na M-Pesa Buy Goods till. */
  mpesa_till: string | null;
  mpesa_paybill: { business_no: string; account_mode: PaybillAccountMode; account: string | null } | null;
  /** Pochi la Biashara: customers pay the business phone number. E.164. */
  pochi: { phone: string } | null;
  /** M-Pesa Send Money to a personal line. E.164. */
  mpesa_send: { phone: string; name: string | null } | null;
  /** Airtel Money: a till, a phone number, or both. */
  airtel: { till: string | null; phone: string | null } | null;
  bank: { bank_name: string; account_name: string; account_no: string } | null;
  card: { where: CardWhere[] } | null;
  /** When customers pay. More than one is allowed (cash before delivery AND on delivery). */
  timings: PaymentTiming[];
  /** Only with deposit_then_balance. */
  deposit_percent: number | null;
  /** Anything else callers should know about paying. Spoken as written. */
  note: string | null;
  source: "owner" | "parsed";
  confirmed: boolean;
  /** Old text we read this from (parsed rows only). */
  parsed_from?: string;
};

export const TILL_RE = /^\d{5,7}$/;
export const PAYBILL_RE = /^\d{5,7}$/;
export const AIRTEL_TILL_RE = /^\d{4,8}$/;
export const BANK_ACCOUNT_RE = /^\d{6,20}$/;
export const ACCOUNT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,39}$/;
export const KE_MOBILE_RE = /^\+254[17]\d{8}$/;
export const NOTE_MAX = 240;

const METHOD_IDS = new Set(PAYMENT_METHODS.map((o) => o.id));
const TIMING_IDS = new Set(PAYMENT_TIMING.map((o) => o.id));
const ACCOUNT_MODE_IDS = new Set(PAYBILL_ACCOUNT_MODES.map((o) => o.id));
const CARD_IDS = new Set(CARD_WHERE.map((o) => o.id));

export function labelOfMethod(id: PaymentMethod): string {
  return PAYMENT_METHODS.find((o) => o.id === id)?.label || id;
}

/** Kenyan mobile (07.., 01.., 7.., +254.., 254..) -> +2547XXXXXXXX / +2541XXXXXXXX, else null. */
export function kenyanMobileE164(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/[\s\-().]/g, "");
  if (!d) return null;
  let m = d.match(/^(?:\+?254|0)?([17]\d{8})$/);
  if (!m) m = d.match(/^\+?2540([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}

/** +254712345678 -> "0712 345 678", how Kenyans read a number out. */
export function kenyanMobileDisplay(e164: string | null | undefined): string {
  const v = String(e164 || "");
  const m = v.match(/^\+254(\d{3})(\d{3})(\d{3})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : v;
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const text = (v: unknown, max = 80) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function emptyPayments(): Payments {
  return {
    version: 2,
    methods: [],
    mpesa_till: null,
    mpesa_paybill: null,
    pochi: null,
    mpesa_send: null,
    airtel: null,
    bank: null,
    card: null,
    timings: [],
    deposit_percent: null,
    note: null,
    source: "owner",
    confirmed: true,
  };
}

/**
 * Read any stored payments value (v1 or v2, or junk) into the v2 shape. Never throws.
 * Unknown methods and timings are dropped; numbers are kept as typed so validation can
 * point at them instead of silently losing them.
 */
export function normalizePayments(raw: unknown): Payments | null {
  const r = obj(raw);
  if (!r) return null;
  const p = emptyPayments();
  p.methods = (Array.isArray(r.methods) ? r.methods : []).map(String).filter((m): m is PaymentMethod => METHOD_IDS.has(m as PaymentMethod));
  p.methods = [...new Set(p.methods)];
  p.mpesa_till = typeof r.mpesa_till === "string" && r.mpesa_till ? r.mpesa_till : null;
  const pb = obj(r.mpesa_paybill);
  if (pb) {
    const account = text(pb.account, 40);
    const mode = ACCOUNT_MODE_IDS.has(pb.account_mode as PaybillAccountMode)
      ? (pb.account_mode as PaybillAccountMode)
      : account && /name/i.test(account)
        ? "customer_name"
        : account && /phone|number|simu/i.test(account) && !/\d{3}/.test(account)
          ? "customer_phone"
          : "fixed";
    p.mpesa_paybill = { business_no: String(pb.business_no ?? ""), account_mode: mode, account: mode === "fixed" ? account : null };
  }
  const pochi = obj(r.pochi);
  if (pochi && pochi.phone) p.pochi = { phone: String(pochi.phone) };
  const send = obj(r.mpesa_send);
  if (send && (send.phone || send.name)) p.mpesa_send = { phone: String(send.phone ?? ""), name: text(send.name, 60) };
  const airtel = obj(r.airtel);
  if (airtel) p.airtel = { till: text(airtel.till, 12), phone: text(airtel.phone, 16) };
  const bank = obj(r.bank);
  if (bank) p.bank = { bank_name: String(bank.bank_name ?? ""), account_name: String(bank.account_name ?? ""), account_no: String(bank.account_no ?? "") };
  const card = obj(r.card);
  if (card) p.card = { where: (Array.isArray(card.where) ? card.where : []).map(String).filter((w): w is CardWhere => CARD_IDS.has(w as CardWhere)) };
  const timings = Array.isArray(r.timings) ? r.timings : r.timing ? [r.timing] : [];
  p.timings = [...new Set(timings.map(String).filter((t): t is PaymentTiming => TIMING_IDS.has(t as PaymentTiming)))];
  const dep = Number(r.deposit_percent);
  p.deposit_percent = r.deposit_percent == null || r.deposit_percent === "" || !Number.isFinite(dep) ? null : dep;
  // v1 kept a deposit without saying when: that is "deposit, then balance".
  if (p.deposit_percent != null && !p.timings.includes("deposit_then_balance")) p.timings.push("deposit_then_balance");
  p.note = text(r.note, NOTE_MAX);
  p.source = r.source === "parsed" ? "parsed" : "owner";
  p.confirmed = r.confirmed !== false;
  if (typeof r.parsed_from === "string" && r.parsed_from.trim()) p.parsed_from = r.parsed_from.trim().slice(0, 500);
  return p;
}

/** Field errors keyed by field id. Empty object = valid. */
export function validatePayments(p: Payments): Record<string, string> {
  const e: Record<string, string> = {};
  const has = (m: PaymentMethod) => p.methods.includes(m);
  for (const m of p.methods) if (!METHOD_IDS.has(m)) e.methods = "Pick from the list.";
  if (has("mpesa_till") && !TILL_RE.test(p.mpesa_till || "")) e.mpesa_till = "A till number is 5 to 7 digits.";
  if (has("mpesa_paybill")) {
    if (!PAYBILL_RE.test(p.mpesa_paybill?.business_no || "")) e.paybill = "A paybill number is 5 to 7 digits.";
    if (p.mpesa_paybill?.account_mode === "fixed" && !ACCOUNT_REF_RE.test(p.mpesa_paybill.account || ""))
      e.paybill_account = "Add the account number customers type, up to 40 letters or numbers.";
  }
  if (has("pochi") && !KE_MOBILE_RE.test(kenyanMobileE164(p.pochi?.phone) || ""))
    e.pochi_phone = "Use a Kenyan mobile number, like 0712 345 678.";
  if (has("mpesa_send") && !KE_MOBILE_RE.test(kenyanMobileE164(p.mpesa_send?.phone) || ""))
    e.send_phone = "Use a Kenyan mobile number, like 0712 345 678.";
  if (has("airtel")) {
    const till = p.airtel?.till ? digits(p.airtel.till) : "";
    const phone = p.airtel?.phone ? kenyanMobileE164(p.airtel.phone) : null;
    if (!till && !p.airtel?.phone) e.airtel = "Add an Airtel Money till or phone number.";
    if (till && !AIRTEL_TILL_RE.test(till)) e.airtel_till = "An Airtel till is 4 to 8 digits.";
    if (p.airtel?.phone && !phone) e.airtel_phone = "Use a Kenyan mobile number, like 0733 123 456.";
  }
  if (has("bank")) {
    if (!String(p.bank?.bank_name || "").trim()) e.bank_name = "Add the bank.";
    if (!String(p.bank?.account_name || "").trim()) e.bank_account_name = "Add the name on the account.";
    if (!BANK_ACCOUNT_RE.test(digits(p.bank?.account_no))) e.bank_account_no = "An account number is 6 to 20 digits.";
  }
  for (const t of p.timings) if (!TIMING_IDS.has(t)) e.timings = "Pick from the list.";
  if (p.timings.includes("deposit_then_balance")) {
    if (!(Number.isInteger(p.deposit_percent) && (p.deposit_percent as number) >= 1 && (p.deposit_percent as number) <= 99))
      e.deposit_percent = "Use a whole number from 1 to 99.";
  } else if (p.deposit_percent != null) e.deposit_percent = "Choose Deposit, then balance to ask for a deposit.";
  if ((p.note || "").length > NOTE_MAX) e.note = `Keep the note under ${NOTE_MAX} characters.`;
  return e;
}

/** Strip anything the owner didn't pick so stale numbers don't linger. Phones to E.164. */
export function cleanPayments(p: Payments): Payments {
  const has = (m: PaymentMethod) => p.methods.includes(m);
  const methods = PAYMENT_METHODS.map((o) => o.id).filter((id) => p.methods.includes(id));
  const timings = PAYMENT_TIMING.map((o) => o.id).filter((id) => p.timings.includes(id));
  const pb = p.mpesa_paybill;
  return {
    ...p,
    version: 2,
    methods,
    mpesa_till: has("mpesa_till") ? digits(p.mpesa_till) : null,
    mpesa_paybill:
      has("mpesa_paybill") && pb
        ? { business_no: digits(pb.business_no), account_mode: pb.account_mode, account: pb.account_mode === "fixed" ? text(pb.account, 40) : null }
        : null,
    pochi: has("pochi") && p.pochi ? { phone: kenyanMobileE164(p.pochi.phone) || p.pochi.phone.trim() } : null,
    mpesa_send: has("mpesa_send") && p.mpesa_send ? { phone: kenyanMobileE164(p.mpesa_send.phone) || p.mpesa_send.phone.trim(), name: text(p.mpesa_send.name, 60) } : null,
    airtel:
      has("airtel") && p.airtel
        ? { till: p.airtel.till ? digits(p.airtel.till) || null : null, phone: p.airtel.phone ? kenyanMobileE164(p.airtel.phone) || p.airtel.phone.trim() : null }
        : null,
    bank:
      has("bank") && p.bank
        ? { bank_name: p.bank.bank_name.trim().slice(0, 60), account_name: p.bank.account_name.trim().slice(0, 80), account_no: digits(p.bank.account_no) }
        : null,
    card: has("card") ? { where: CARD_WHERE.map((o) => o.id).filter((w) => p.card?.where.includes(w)) } : null,
    timings,
    deposit_percent: timings.includes("deposit_then_balance") ? p.deposit_percent : null,
    note: text(p.note, NOTE_MAX),
  };
}

/** Short value for a method row in Settings ("123456", "0712 345 678"). */
export function methodSummary(p: Payments, m: PaymentMethod): string {
  switch (m) {
    case "mpesa_till":
      return p.mpesa_till || "Add till number";
    case "mpesa_paybill": {
      const pb = p.mpesa_paybill;
      if (!pb?.business_no) return "Add paybill number";
      const acc = pb.account_mode === "fixed" ? `account ${pb.account || "?"}` : (PAYBILL_ACCOUNT_MODES.find((o) => o.id === pb.account_mode)?.label || "").toLowerCase();
      return `${pb.business_no}, ${acc}`;
    }
    case "pochi":
      return p.pochi?.phone ? kenyanMobileDisplay(kenyanMobileE164(p.pochi.phone) || p.pochi.phone) : "Add phone number";
    case "mpesa_send":
      return p.mpesa_send?.phone ? kenyanMobileDisplay(kenyanMobileE164(p.mpesa_send.phone) || p.mpesa_send.phone) : "Add phone number";
    case "airtel": {
      const bits = [p.airtel?.till ? `till ${p.airtel.till}` : "", p.airtel?.phone ? kenyanMobileDisplay(kenyanMobileE164(p.airtel.phone) || p.airtel.phone) : ""].filter(Boolean);
      return bits.join(", ") || "Add till or phone";
    }
    case "bank":
      return p.bank?.bank_name ? `${p.bank.bank_name}${p.bank.account_no ? `, ${p.bank.account_no}` : ""}` : "Add bank details";
    case "card":
      return p.card?.where.length ? p.card.where.map((w) => CARD_WHERE.find((o) => o.id === w)?.label).join(", ") : "Visa and Mastercard";
    default:
      return "";
  }
}

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

/** How a method reads aloud in the payment line. */
function spokenMethod(p: Payments, m: PaymentMethod): string {
  switch (m) {
    case "mpesa_till":
      return p.mpesa_till ? `M-Pesa Buy Goods Till ${p.mpesa_till}` : "M-Pesa Buy Goods";
    case "mpesa_paybill": {
      const pb = p.mpesa_paybill;
      if (!pb?.business_no) return "M-Pesa Paybill";
      const acc =
        pb.account_mode === "fixed" && pb.account
          ? `account ${pb.account}`
          : pb.account_mode === "customer_name"
            ? "with your name as the account"
            : pb.account_mode === "customer_phone"
              ? "with your phone number as the account"
              : pb.account_mode === "order_no"
                ? "with your order number as the account"
                : "";
      return `M-Pesa Paybill ${pb.business_no}${acc ? `, ${acc}` : ""}`;
    }
    case "pochi":
      return p.pochi?.phone ? `Pochi la Biashara on ${kenyanMobileDisplay(kenyanMobileE164(p.pochi.phone) || p.pochi.phone)}` : "Pochi la Biashara";
    case "mpesa_send":
      return p.mpesa_send?.phone
        ? `M-Pesa Send Money to ${kenyanMobileDisplay(kenyanMobileE164(p.mpesa_send.phone) || p.mpesa_send.phone)}${p.mpesa_send.name ? ` (${p.mpesa_send.name})` : ""}`
        : "M-Pesa Send Money";
    case "airtel": {
      const bits = [p.airtel?.till ? `till ${p.airtel.till}` : "", p.airtel?.phone ? kenyanMobileDisplay(kenyanMobileE164(p.airtel.phone) || p.airtel.phone) : ""].filter(Boolean);
      return bits.length ? `Airtel Money ${bits.join(" or ")}` : "Airtel Money";
    }
    case "bank":
      return p.bank?.bank_name
        ? `bank transfer to ${p.bank.bank_name}${p.bank.account_no ? `, account ${p.bank.account_no}` : ""}${p.bank.account_name ? `, ${p.bank.account_name}` : ""}`
        : "bank transfer";
    case "card": {
      const where = p.card?.where || [];
      if (!where.length) return "card";
      const w = where.map((x) => (x === "in_shop" ? "in the shop" : x === "on_delivery" ? "on delivery" : "by payment link"));
      return `card ${joinOr(w)}`;
    }
    case "cash":
      return "cash";
    case "cheque":
      return "cheque";
  }
}

/**
 * The payment line the Business Assistant says, built only from the fields.
 * "You can pay by M-Pesa Buy Goods Till 123456, Pochi la Biashara on 0712 345 678 or cash.
 *  Customers pay a 30% deposit first, then the balance, or on delivery. Note: ..."
 */
export function paymentsSentence(p: Payments): string {
  const out: string[] = [];
  const methods = p.methods.map((m) => spokenMethod(p, m));
  if (methods.length) out.push(`You can pay by ${joinOr(methods)}.`);
  const when = p.timings.map((t) => {
    if (t === "deposit_then_balance") return p.deposit_percent ? `a ${p.deposit_percent}% deposit first, then the balance` : "a deposit first, then the balance";
    return PAYMENT_TIMING.find((o) => o.id === t)?.speak || t;
  });
  if (when.length) out.push(`Customers pay ${joinOr(when)}.`);
  if (p.note) out.push(/[.!?]$/.test(p.note) ? p.note : `${p.note}.`);
  return out.join(" ").trim();
}

export function paymentsHaveContent(p: Payments | null): boolean {
  return Boolean(p && (p.methods.length || p.timings.length || p.note));
}

/**
 * Read old free text into typed fields (setup FAQ answers, legacy policy text). Never
 * throws. Anything not clearly stated is left empty, and the result is marked parsed and
 * unconfirmed so Settings asks "Is this right?" first.
 */
export function parsePaymentsText(...texts: unknown[]): Payments | null {
  const raw = texts.map((x) => String(x ?? "")).join(" ").trim();
  const t = raw.toLowerCase();
  if (!t) return null;
  const p = emptyPayments();
  const add = (m: PaymentMethod) => !p.methods.includes(m) && p.methods.push(m);
  const phoneAfter = (re: RegExp) => {
    const m = t.match(re);
    return m ? kenyanMobileE164(m[1]) : null;
  };
  const till = t.match(/\b(?:till|buy goods)(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})\b/);
  const paybill = t.match(/\bpay\s*bill(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})(?:[^\d]{1,20}(?:acc(?:ount)?|a\/c)(?:\s*(?:no\.?|number|#|is))?\s*[:\-]?\s*([a-z0-9-]{1,40}(?: (?:name|number|no))?))?/);
  if (till) { add("mpesa_till"); p.mpesa_till = till[1]; }
  else if (/\btill\b|buy goods/.test(t) && !/airtel/.test(t)) add("mpesa_till");
  if (paybill) {
    add("mpesa_paybill");
    const acc = (paybill[2] || "").trim();
    const mode: PaybillAccountMode = /^(your )?name/.test(acc) || /\bname\b/.test(acc) ? "customer_name" : /^(your )?(phone|number|simu)/.test(acc) ? "customer_phone" : acc ? "fixed" : "fixed";
    p.mpesa_paybill = { business_no: paybill[1], account_mode: mode, account: mode === "fixed" ? acc || null : null };
  } else if (/pay\s*bill/.test(t)) add("mpesa_paybill");
  if (/pochi/.test(t)) {
    add("pochi");
    const ph = phoneAfter(/pochi[^0-9+]{0,30}((?:\+?254|0)[17][\d\s]{8,11})/);
    if (ph) p.pochi = { phone: ph };
  }
  const sendPhone = phoneAfter(/(?:send money|tuma pesa|send to|m-?pesa (?:to|on|number))[^0-9+]{0,20}((?:\+?254|0)[17][\d\s]{8,11})/);
  if (sendPhone) { add("mpesa_send"); p.mpesa_send = { phone: sendPhone, name: null }; }
  else if (/m-?pesa|mpesa/.test(t) && !p.methods.some((m) => m.startsWith("mpesa") || m === "pochi")) add("mpesa_send");
  if (/airtel/.test(t)) {
    add("airtel");
    const at = t.match(/airtel[^0-9]{0,25}till[^0-9]{0,10}(\d{4,8})\b/);
    const ap = phoneAfter(/airtel[^0-9+]{0,25}((?:\+?254|0)[17][\d\s]{8,11})/);
    p.airtel = { till: at ? at[1] : null, phone: ap };
  }
  if (/\bcash\b|pesa taslimu/.test(t)) add("cash");
  if (/\bcards?\b|visa|mastercard|\bpos\b/.test(t)) add("card");
  if (/\bbank|\beft\b|rtgs|pesalink/.test(t)) add("bank");
  if (/cheque|check payment/.test(t)) add("cheque");
  const dep = t.match(/(\d{1,2})\s*%\s*(?:deposit|down|upfront|advance)|(?:deposit|down|upfront|advance)[^\d%]{0,20}(\d{1,2})\s*%/);
  if (dep) p.deposit_percent = Number(dep[1] || dep[2]);
  const tm = (id: PaymentTiming) => !p.timings.includes(id) && p.timings.push(id);
  if (/before delivery|pay first|in advance|kabla ya delivery/.test(t)) tm("before_delivery");
  if (/on delivery|cash on delivery|\bcod\b|pay when (it|you) (arrive|receive)/.test(t)) tm("on_delivery");
  if (/when (you )?collect|on (pick ?up|collection)|at the shop/.test(t)) tm("at_pickup");
  if (/before (we|the job|work) start|upfront/.test(t)) tm(p.deposit_percent != null ? "deposit_then_balance" : "before_service");
  if (/after (the )?(job|work|service)|baada ya kazi/.test(t)) tm("after_service");
  if (/invoice|credit terms|30 days|on account/.test(t)) tm("on_account");
  if (p.deposit_percent != null) tm("deposit_then_balance");
  p.timings = PAYMENT_TIMING.map((o) => o.id).filter((id) => p.timings.includes(id));
  if (!p.methods.length && !p.timings.length) return null;
  return { ...p, source: "parsed", confirmed: false, parsed_from: raw.slice(0, 500) };
}
