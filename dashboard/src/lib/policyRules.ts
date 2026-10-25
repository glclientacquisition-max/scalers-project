/**
 * Policy rules as short sets of choices plus an optional note. Stored at
 * tenants.business_policies.rules. The text keys the call brain already reads
 * (returns, delivery, cancellation, warranty) are generated from these on save, so the
 * Business Assistant only ever quotes what the owner picked.
 *
 * Booking changes and late/no-show are spoken inside the Cancellation line, because the
 * call brain answers "can I cancel / move / what if I'm late" from that one topic.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

type Opt = { id: string; label: string; detail?: string; speak?: string };

export type PolicyTopic = "returns" | "delivery" | "cancellation" | "booking_changes" | "no_show" | "warranty";
export const POLICY_TOPICS = taxonomy.policy_topics as Array<Opt & { id: PolicyTopic }>;
export const RETURNS_MODES = taxonomy.returns_modes as Array<Opt & { id: ReturnsRule["mode"] }>;
export const RETURNS_CONDITIONS = taxonomy.returns_conditions as Array<Opt & { id: ReturnsCondition }>;
export const DELIVERY_MODES = taxonomy.delivery_modes as Array<Opt & { id: DeliveryRule["mode"] }>;
export const DELIVERY_FEE_MODES = taxonomy.delivery_fee_modes as Array<Opt & { id: DeliveryFeeMode }>;
export const DELIVERY_SPEEDS = taxonomy.delivery_speeds as Array<Opt & { id: DeliverySpeed }>;
export const CANCEL_FEES = taxonomy.cancel_fees as Array<Opt & { id: CancelFee }>;
export const NO_SHOW_CHARGES = taxonomy.no_show_charges as Array<Opt & { id: NoShowCharge }>;
export const WARRANTY_COVERS = taxonomy.warranty_covers as Array<Opt & { id: WarrantyCover }>;

export type ReturnsCondition = "unused" | "receipt" | "packaging" | "not_custom" | "faulty_only";
export type DeliveryFeeMode = "free" | "flat" | "by_area" | "rider";
export type DeliverySpeed = "same_day" | "next_day" | "two_three_days" | "scheduled";
export type CancelFee = "none" | "deposit_kept" | "flat";
export type NoShowCharge = "none" | "callout" | "deposit_kept";
export type WarrantyCover = "workmanship" | "parts" | "manufacturer";

/** Shared by every topic: "custom" means the owner's own words (note, plus optional Kiswahili note_sw) are the whole line. */
type RuleExtras = { mode?: string; note_sw?: string | null; answer?: string };
export type ReturnsRule = RuleExtras & { mode: "refund_or_exchange" | "exchange" | "store_credit" | "none" | "custom"; days: number | null; conditions: ReturnsCondition[]; note: string | null };
export type DeliveryRule = RuleExtras & {
  mode: "deliver" | "pickup_only" | "custom";
  fee_mode: DeliveryFeeMode | null;
  fee_ksh: number | null;
  free_over_ksh: number | null;
  speed: DeliverySpeed | null;
  /** "14:00": orders before this time go out the same day. */
  cutoff: string | null;
  areas: string | null;
  note: string | null;
};
export type CancellationRule = RuleExtras & { allowed?: boolean; notice_hours: number | null; fee: CancelFee; fee_ksh: number | null; note: string | null };
export type BookingChangesRule = RuleExtras & { allowed: boolean; notice_hours: number | null; note: string | null };
export type NoShowRule = RuleExtras & { wait_minutes: number | null; charge: NoShowCharge; fee_ksh: number | null; note: string | null };
export type WarrantyRule = RuleExtras & { none?: boolean; months: number | null; covers: WarrantyCover[]; note: string | null };

export type PolicyRules = Partial<{
  returns: ReturnsRule;
  delivery: DeliveryRule;
  cancellation: CancellationRule;
  booking_changes: BookingChangesRule;
  no_show: NoShowRule;
  warranty: WarrantyRule;
}>;

export const RULE_NOTE_MAX = 200;
export const NOTICE_HOURS = [0, 2, 6, 12, 24, 48] as const;
export const RETURN_DAYS = [1, 3, 7, 14, 30] as const;
export const WAIT_MINUTES = [10, 15, 30, 60] as const;
export const WARRANTY_MONTHS = [1, 3, 6, 12, 24] as const;
const MAX_KSH = 1_000_000;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const note = (v: unknown) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, RULE_NOTE_MAX);
  return s || null;
};
const int = (v: unknown, max: number): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const pick = <T extends string>(list: Array<{ id: string }>, v: unknown, fallback: T): T =>
  (list.some((o) => o.id === v) ? v : fallback) as T;
const pickMany = <T extends string>(list: Array<{ id: string }>, v: unknown): T[] =>
  list.map((o) => o.id).filter((id) => Array.isArray(v) && v.includes(id)) as T[];

export function emptyRule(topic: PolicyTopic): NonNullable<PolicyRules[PolicyTopic]> {
  switch (topic) {
    case "returns":
      return { mode: "refund_or_exchange", days: 7, conditions: ["unused", "receipt"], note: null };
    case "delivery":
      return { mode: "deliver", fee_mode: "by_area", fee_ksh: null, free_over_ksh: null, speed: "same_day", cutoff: null, areas: null, note: null };
    case "cancellation":
      return { notice_hours: 24, fee: "none", fee_ksh: null, note: null };
    case "booking_changes":
      return { allowed: true, notice_hours: 24, note: null };
    case "no_show":
      return { wait_minutes: 15, charge: "none", fee_ksh: null, note: null };
    case "warranty":
      return { months: 3, covers: ["workmanship"], note: null };
  }
}

export const RULE_NOTE_SW_MAX = RULE_NOTE_MAX;
const ANSWER_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** mode "custom", note_sw and the Policies screen's answer id ride along on every topic. */
function extras(src: Record<string, unknown>): RuleExtras {
  const out: RuleExtras = {};
  const sw = String(src.note_sw ?? "").replace(/\s+/g, " ").trim().slice(0, RULE_NOTE_SW_MAX);
  if (sw) out.note_sw = sw;
  if (typeof src.answer === "string" && ANSWER_RE.test(src.answer)) out.answer = src.answer;
  return out;
}
const isCustom = (src: Record<string, unknown>) => src.mode === "custom";
const custom = (src: Record<string, unknown>) => ({ ...extras(src), mode: "custom" as const, note: note(src.note) });

/**
 * Read stored rules (or junk) into well-formed rules. Topics this file does not know
 * (added by a niche in policyRegistry.ts) keep their scalar fields, note and note_sw.
 */
export function normalizeRules(raw: unknown): PolicyRules {
  const r = obj(raw) || {};
  const out: PolicyRules = {};
  const known = new Set<string>(["returns", "delivery", "cancellation", "booking_changes", "no_show", "warranty"]);
  for (const [k, v] of Object.entries(r)) {
    const o = obj(v);
    if (known.has(k) || !o || !ANSWER_RE.test(k)) continue;
    const clean: Record<string, unknown> = {};
    for (const [f, x] of Object.entries(o)) {
      if (!ANSWER_RE.test(f)) continue;
      if (f === "note") clean.note = note(x);
      else if (f === "note_sw") { const e = extras(o); if (e.note_sw) clean.note_sw = e.note_sw; }
      else if (typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) clean[f] = x;
      else if (typeof x === "string") clean[f] = x.slice(0, 40);
      else if (Array.isArray(x)) clean[f] = x.filter((y) => typeof y === "string").map((y) => String(y).slice(0, 40)).slice(0, 10);
    }
    (out as Record<string, unknown>)[k] = clean;
  }
  const ret = obj(r.returns);
  if (ret && isCustom(ret)) out.returns = { ...custom(ret), days: null, conditions: [] };
  else if (ret) out.returns = { ...extras(ret), mode: pick(RETURNS_MODES, ret.mode, "refund_or_exchange"), days: int(ret.days, 365), conditions: pickMany(RETURNS_CONDITIONS, ret.conditions), note: note(ret.note) };
  const del = obj(r.delivery);
  if (del && isCustom(del)) out.delivery = { ...custom(del), fee_mode: null, fee_ksh: null, free_over_ksh: null, speed: null, cutoff: null, areas: null };
  else if (del) {
    const cutoff = typeof del.cutoff === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(del.cutoff) ? del.cutoff : null;
    out.delivery = {
      ...extras(del),
      mode: pick(DELIVERY_MODES, del.mode, "deliver"),
      fee_mode: DELIVERY_FEE_MODES.some((o) => o.id === del.fee_mode) ? (del.fee_mode as DeliveryFeeMode) : null,
      fee_ksh: int(del.fee_ksh, MAX_KSH),
      free_over_ksh: int(del.free_over_ksh, MAX_KSH),
      speed: DELIVERY_SPEEDS.some((o) => o.id === del.speed) ? (del.speed as DeliverySpeed) : null,
      cutoff,
      areas: note(del.areas),
      note: note(del.note),
    };
  }
  const can = obj(r.cancellation);
  if (can && isCustom(can)) out.cancellation = { ...custom(can), notice_hours: null, fee: "none", fee_ksh: null };
  else if (can) out.cancellation = { ...extras(can), ...(can.allowed === false ? { allowed: false } : {}), notice_hours: int(can.notice_hours, 720), fee: pick(CANCEL_FEES, can.fee, "none"), fee_ksh: int(can.fee_ksh, MAX_KSH), note: note(can.note) };
  const bc = obj(r.booking_changes);
  if (bc && isCustom(bc)) out.booking_changes = { ...custom(bc), allowed: true, notice_hours: null };
  else if (bc) out.booking_changes = { ...extras(bc), allowed: bc.allowed !== false, notice_hours: int(bc.notice_hours, 720), note: note(bc.note) };
  const ns = obj(r.no_show);
  if (ns && isCustom(ns)) out.no_show = { ...custom(ns), wait_minutes: null, charge: "none", fee_ksh: null };
  else if (ns) out.no_show = { ...extras(ns), wait_minutes: int(ns.wait_minutes, 240), charge: pick(NO_SHOW_CHARGES, ns.charge, "none"), fee_ksh: int(ns.fee_ksh, MAX_KSH), note: note(ns.note) };
  const w = obj(r.warranty);
  if (w && isCustom(w)) out.warranty = { ...custom(w), months: null, covers: [] };
  else if (w && w.none === true) out.warranty = { ...extras(w), none: true, months: null, covers: [], note: note(w.note) };
  else if (w) out.warranty = { ...extras(w), months: int(w.months, 120), covers: pickMany(WARRANTY_COVERS, w.covers), note: note(w.note) };
  return out;
}

/** Field errors keyed "topic.field". */
export function validateRules(rules: PolicyRules): Record<string, string> {
  const e: Record<string, string> = {};
  const r = rules.returns;
  if (r && r.mode !== "none" && r.mode !== "custom" && !(r.days && r.days >= 1)) e["returns.days"] = "Pick how many days customers have.";
  const d = rules.delivery;
  if (d && d.mode === "deliver") {
    if (d.fee_mode === "flat" && !(d.fee_ksh && d.fee_ksh > 0)) e["delivery.fee_ksh"] = "Add the delivery fee in KSh.";
    if (d.free_over_ksh != null && d.free_over_ksh <= 0) e["delivery.free_over_ksh"] = "Use an amount above 0.";
  }
  const c = rules.cancellation;
  if (c && c.mode !== "custom" && c.allowed !== false && c.fee === "flat" && !(c.fee_ksh && c.fee_ksh > 0)) e["cancellation.fee_ksh"] = "Add the cancellation fee in KSh.";
  const n = rules.no_show;
  if (n && n.mode !== "custom" && n.charge === "callout" && !(n.fee_ksh && n.fee_ksh > 0)) e["no_show.fee_ksh"] = "Add the call-out fee in KSh.";
  const w = rules.warranty;
  if (w && w.mode !== "custom" && !w.none && !(w.months && w.months >= 1)) e["warranty.months"] = "Pick how long the warranty lasts.";
  return e;
}

const ksh = (n: number) => `KSh ${n.toLocaleString("en-US")}`;
const hours = (h: number) => (h === 0 ? "any time before" : h < 24 ? `${h} hours before` : h === 24 ? "a day before" : `${h / 24} days before`);
const months = (m: number) => (m === 12 ? "1 year" : m === 24 ? "2 years" : `${m} month${m === 1 ? "" : "s"}`);
const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
};
const withNote = (s: string, n: string | null) => [s, n ? (/[.!?]$/.test(n) ? n : `${n}.`) : ""].filter(Boolean).join(" ");
const joinAnd = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

export function returnsSentence(r: ReturnsRule): string {
  if (r.mode === "custom") return withNote("", r.note);
  if (r.mode === "none") return withNote("We do not take returns.", r.note);
  const what = r.mode === "exchange" ? "exchange" : r.mode === "store_credit" ? "give store credit for" : "refund or exchange";
  const conds = r.conditions.filter((c) => c !== "faulty_only").map((c) => RETURNS_CONDITIONS.find((o) => o.id === c)?.speak || c);
  const faulty = r.conditions.includes("faulty_only");
  let s = `We ${what} ${faulty ? "faulty items" : "items"} within ${r.days ?? 7} day${r.days === 1 ? "" : "s"}`;
  if (conds.length) s += ` if ${joinAnd(conds)}`;
  return withNote(`${s}.`, r.note);
}

export function deliverySentence(d: DeliveryRule): string {
  if (d.mode === "custom") return withNote("", d.note);
  if (d.mode === "pickup_only") return withNote("We do not deliver. Customers collect from us.", d.note);
  const parts: string[] = ["We deliver"];
  // Areas and fees live in Service areas (tenant_area_picks); stored values here are not spoken.
  if (d.speed) parts[0] += ` ${DELIVERY_SPEEDS.find((o) => o.id === d.speed)?.speak || ""}`;
  if (d.speed === "same_day" && d.cutoff) parts[0] += ` for orders before ${time12(d.cutoff)}`;
  parts[0] += ".";
  return withNote(parts.join(" "), d.note);
}

export function cancellationSentence(c: CancellationRule): string {
  if (c.mode === "custom") return withNote("", c.note);
  if (c.allowed === false) return withNote("We don't accept cancellations.", c.note);
  let s = c.notice_hours == null || c.notice_hours === 0 ? "Customers can cancel any time" : `Customers can cancel up to ${hours(c.notice_hours)}`;
  s += c.fee === "none" ? " at no charge." : c.fee === "deposit_kept" ? ". After that, the deposit is kept." : c.fee_ksh ? `. After that, there is a ${ksh(c.fee_ksh)} fee.` : ". After that, there is a fee.";
  if (c.notice_hours === 0 && c.fee !== "none") s = c.fee === "deposit_kept" ? "If a customer cancels, the deposit is kept." : `Cancelling costs ${c.fee_ksh ? ksh(c.fee_ksh) : "a fee"}.`;
  return withNote(s, c.note);
}

export function bookingChangesSentence(b: BookingChangesRule): string {
  if (b.mode === "custom") return withNote("", b.note);
  if (!b.allowed) return withNote("Bookings cannot be moved; cancel and book again.", b.note);
  return withNote(b.notice_hours ? `Customers can move a booking up to ${hours(b.notice_hours)}.` : "Customers can move a booking any time.", b.note);
}

export function noShowSentence(n: NoShowRule): string {
  if (n.mode === "custom") return withNote("", n.note);
  let s = n.wait_minutes ? `We wait ${n.wait_minutes} minutes if the customer is late or not in.` : "If the customer is late or not in, we call them first.";
  if (n.charge === "callout") s += n.fee_ksh ? ` After that, a ${ksh(n.fee_ksh)} call-out fee applies.` : " After that, a call-out fee applies.";
  if (n.charge === "deposit_kept") s += " After that, the deposit is kept.";
  return withNote(s, n.note);
}

export function warrantySentence(w: WarrantyRule): string {
  if (w.mode === "custom") return withNote("", w.note);
  if (w.none) return withNote("We don't give a guarantee.", w.note);
  const covers = w.covers.map((c) => WARRANTY_COVERS.find((o) => o.id === c)?.speak || c);
  const s = `We give a ${months(w.months ?? 3)} warranty${covers.length ? ` on ${joinAnd(covers)}` : ""}.`;
  return withNote(s, w.note);
}

export function ruleSentence(topic: PolicyTopic, rules: PolicyRules): string {
  switch (topic) {
    case "returns":
      return rules.returns ? returnsSentence(rules.returns) : "";
    case "delivery":
      return rules.delivery ? deliverySentence(rules.delivery) : "";
    case "cancellation":
      return rules.cancellation ? cancellationSentence(rules.cancellation) : "";
    case "booking_changes":
      return rules.booking_changes ? bookingChangesSentence(rules.booking_changes) : "";
    case "no_show":
      return rules.no_show ? noShowSentence(rules.no_show) : "";
    case "warranty":
      return rules.warranty ? warrantySentence(rules.warranty) : "";
  }
}

/** Topics offered per business type, in the order owners think about them. */
export function topicsFor(vertical: string | null | undefined): PolicyTopic[] {
  return vertical === "home_services"
    ? ["cancellation", "booking_changes", "no_show", "warranty", "returns"]
    : ["returns", "delivery", "cancellation", "warranty"];
}

/**
 * Policy text keys the call brain reads, generated from the rules. A topic with no rule
 * returns undefined so the caller keeps whatever text is stored (legacy owners).
 */
export function policyTextFromRules(rules: PolicyRules): Partial<Record<"returns" | "delivery" | "cancellation" | "warranty", string>> {
  const out: Partial<Record<"returns" | "delivery" | "cancellation" | "warranty", string>> = {};
  if (rules.returns) out.returns = returnsSentence(rules.returns);
  if (rules.delivery) out.delivery = deliverySentence(rules.delivery);
  if (rules.warranty) out.warranty = warrantySentence(rules.warranty);
  const cancel = [rules.cancellation && cancellationSentence(rules.cancellation), rules.booking_changes && bookingChangesSentence(rules.booking_changes), rules.no_show && noShowSentence(rules.no_show)].filter(Boolean) as string[];
  // Whole sentences only, never cut mid-sentence (audit 2026-10-25): three custom notes (3 x 200) plus the
  // generated lines fit under CANCELLATION_TEXT_MAX; Brain splits the text into sentences (ownerFacts.js).
  if (cancel.length) out.cancellation = joinWholeSentences(cancel, CANCELLATION_TEXT_MAX);
  return out;
}

export const CANCELLATION_TEXT_MAX = 1200;
/** Join sentences; drop whole trailing sentences past max instead of cutting one in half. */
export function joinWholeSentences(parts: string[], max: number): string {
  const sentences = parts.join(" ").match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [];
  let out = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out;
}
