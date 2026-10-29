/**
 * Settings › Policies remake (one page, cards that each save on their own).
 * Pure logic shared by the page, its server action and tests:
 * which rules a business type sees, the suggested default for each, the one
 * "When customers pay" question for services, and the small patch each card
 * saves (applied on top of the stored policies, never the whole page).
 *
 * Spoken text is still generated on save by applyStructuredPolicies; nothing
 * here changes what a rule says, only which rules are offered and how a card
 * writes its own keys.
 */
import { UNKNOWN_ANSWER_DEFAULT_EN } from "./unknownAnswerSpoken";
import {
  PAYMENT_TIMING,
  normalizePayments,
  paymentsHaveContent,
  paymentsSentence,
  type PaybillAccountMode,
  type PaymentTiming,
  type Payments,
} from "./payments";
import {
  POLICY_TOPICS,
  joinWholeSentences,
  normalizeRules,
  ruleSentence,
  type PolicyRules,
  type PolicyTopic,
} from "./policyRules";
import { businessPoliciesForStorage, normalizeBusinessPolicies, seedStarterPolicies, type BusinessPolicies } from "./businessPolicies";
import { cleanLegacyPolicyText } from "./ownerPolicyCopy";
import {
  CUSTOM,
  TOPICS,
  applyTopicPatch,
  draftFrom,
  nicheById,
  nicheFor,
  ruleFromDraft,
  spokenLine,
  topicPatch,
  type NicheDef,
  type Rule,
  type Spoken,
} from "./policyRegistry";

/** Services: home services and other booked work. Retail: shops. Picked from the type, then the name. */
export type PoliciesKind = "services" | "retail";

export type PoliciesTenantLike = { vertical?: string | null; business_name?: string | null; business_category?: string | null };

export function policiesKind(t: PoliciesTenantLike | string | null | undefined): PoliciesKind {
  const like: PoliciesTenantLike = typeof t === "string" || t == null ? { vertical: t ?? null } : t;
  const v = String(like.vertical ?? "").trim().toLowerCase();
  if (v === "home_services" || v === "home") return "services";
  if (v === "retail" || v === "shop") return "retail";
  return nicheFor(like).id === "retail" ? "retail" : "services";
}

/** The registry niche that words the spoken lines (cleaning, shop or general). */
export function policiesNiche(t: PoliciesTenantLike, kind: PoliciesKind = policiesKind(t)): NicheDef {
  const n = nicheFor(t);
  if (kind === "retail") return nicheById("retail");
  return n.id === "retail" ? nicheById("generic") : n;
}

/** Rules each business type sees, in the order owners think about them. */
export const RULE_TOPICS: Record<PoliciesKind, readonly PolicyTopic[]> = {
  services: ["cancellation", "booking_changes", "no_show", "warranty"],
  retail: ["returns", "delivery", "cancellation", "warranty"],
};

export function rulesFor(kind: PoliciesKind): PolicyTopic[] {
  return [...RULE_TOPICS[kind]];
}

/** Row label. Services call the warranty a guarantee (on the work, not a product). */
export function ruleLabel(topic: PolicyTopic, kind: PoliciesKind): string {
  if (topic === "warranty" && kind === "services") return "Guarantee";
  return POLICY_TOPICS.find((o) => o.id === topic)?.label || topic;
}

/** The stored text key the older call paths read for a topic. */
export type PolicyTextKey = "returns" | "delivery" | "cancellation" | "warranty";
export const TEXT_KEY: Record<PolicyTopic, PolicyTextKey> = {
  returns: "returns",
  delivery: "delivery",
  cancellation: "cancellation",
  booking_changes: "cancellation",
  no_show: "cancellation",
  warranty: "warranty",
};

export type StoredPolicies = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function storedRules(raw: StoredPolicies): Record<string, Rule> {
  return isObj(raw.rules) ? (raw.rules as Record<string, Rule>) : {};
}
export function storedLines(raw: StoredPolicies): Record<string, Spoken> {
  return isObj(raw.policy_lines) ? (raw.policy_lines as Record<string, Spoken>) : {};
}

/** Suggested rule when the owner has not set one: the topic's first answer with its usual values. */
export function defaultRule(topic: PolicyTopic): Rule {
  const def = TOPICS[topic];
  const draft = draftFrom(def, null);
  return ruleFromDraft(def, { ...draft, answer: def.answers[0].id }) as Rule;
}

/** What callers hear for a saved rule: Desk's stored line first (what Brain speaks), else the line it builds. */
export function savedRuleLine(raw: StoredPolicies, topic: PolicyTopic, niche: NicheDef): string {
  const line = storedLines(raw)[topic];
  if (isObj(line) && str(line.en)) return str(line.en);
  const rule = storedRules(raw)[topic];
  if (!rule) return "";
  if (rule.mode === CUSTOM) return str(rule.note);
  // Older rows saved before the registry: the typed sentence they were saved with.
  const legacy = ruleSentence(topic, normalizeRules({ [topic]: rule }) as PolicyRules);
  return legacy || spokenLine(TOPICS[topic], rule, niche).en;
}

export type RuleRowView = {
  topic: PolicyTopic;
  label: string;
  /** What callers hear now, or the suggestion when nothing is set. */
  sentence: string;
  state: "set" | "old_text" | "suggested";
};

/** One plain sentence per rule: the saved rule, the old typed text, or the suggestion. */
export function ruleRows(raw: StoredPolicies, kind: PoliciesKind, niche: NicheDef): RuleRowView[] {
  const rules = storedRules(raw);
  return rulesFor(kind).map((topic) => {
    const label = ruleLabel(topic, kind);
    if (rules[topic]) return { topic, label, sentence: savedRuleLine(raw, topic, niche), state: "set" as const };
    const old = legacyTopicText(raw, topic);
    if (old) return { topic, label, sentence: old, state: "old_text" as const };
    return { topic, label, sentence: spokenLine(TOPICS[topic], defaultRule(topic), niche).en, state: "suggested" as const };
  });
}

/** Old free text for a topic with no rule yet (only topics that own their text key). */
export function legacyTopicText(raw: StoredPolicies, topic: PolicyTopic): string | null {
  if (topic === "booking_changes" || topic === "no_show") return null;
  const rules = storedRules(raw);
  // Cancellation text is built from three rules; any of them set means it is not "old".
  if (topic === "cancellation" && (rules.booking_changes || rules.no_show)) return null;
  // Starter text we wrote is not the owner's: it is offered under Anything else, not shown as theirs.
  if (starterKeys(raw).has(TEXT_KEY[topic])) return null;
  return cleanLegacyPolicyText(raw[TEXT_KEY[topic]]);
}

/** Policy keys holding starter text the owner has not kept yet. */
export function starterKeys(raw: StoredPolicies): Set<string> {
  return new Set(seedStarterPolicies(normalizeBusinessPolicies(raw)).map((s) => s.key));
}

export type HiddenNote = { topic: PolicyTopic; label: string; text: string };

/**
 * Rules this business type does not use (a cleaner's Returns or Delivery) that still hold
 * something. Never dropped silently: the page lists them so the owner can remove them.
 */
export function hiddenNotes(raw: StoredPolicies, kind: PoliciesKind, niche: NicheDef): HiddenNote[] {
  const shown = new Set(rulesFor(kind));
  const rules = storedRules(raw);
  const out: HiddenNote[] = [];
  for (const o of POLICY_TOPICS) {
    const topic = o.id;
    if (shown.has(topic)) continue;
    const text = rules[topic] ? savedRuleLine(raw, topic, niche) : legacyTopicText(raw, topic);
    if (text && text.trim()) out.push({ topic, label: o.label, text: text.trim() });
  }
  return out;
}

/* ---------------- When customers pay ---------------- */

export type ServicePayAnswer = "before" | "after" | "deposit";
export const SERVICE_PAY_ANSWERS: ReadonlyArray<{ id: ServicePayAnswer; label: string }> = [
  { id: "before", label: "Before the job" },
  { id: "after", label: "After the job" },
  { id: "deposit", label: "Deposit, then balance" },
];
export const DEFAULT_DEPOSIT_PERCENT = 50;
/** Suggested when nothing is set: most home services are paid when the job is done. */
export const SUGGESTED_SERVICE_PAY: ServicePayAnswer = "after";

/** Stored timings to the one services answer. A deposit wins: it is the strictest rule. */
export function servicePayAnswer(p: Pick<Payments, "timings"> | null | undefined): ServicePayAnswer | null {
  const t = p?.timings ?? [];
  if (t.includes("deposit_then_balance")) return "deposit";
  if (t.includes("before_service") || t.includes("before_delivery")) return "before";
  if (t.includes("after_service") || t.includes("on_delivery")) return "after";
  return null;
}

/** The services answer back to stored timings. The deposit % rides only with the third answer. */
export function timingsForServiceAnswer(
  answer: ServicePayAnswer,
  depositPercent: number | null | undefined
): Pick<Payments, "timings" | "deposit_percent"> {
  if (answer === "before") return { timings: ["before_service"], deposit_percent: null };
  if (answer === "after") return { timings: ["after_service"], deposit_percent: null };
  const pct = Number(depositPercent);
  return {
    timings: ["deposit_then_balance"],
    deposit_percent: Number.isInteger(pct) && pct >= 1 && pct <= 99 ? pct : DEFAULT_DEPOSIT_PERCENT,
  };
}

/** Retail never sees the job timings; services never see delivery timings. */
export const RETAIL_TIMINGS: readonly PaymentTiming[] = ["before_delivery", "on_delivery", "at_pickup", "deposit_then_balance", "on_account"];
export const SUGGESTED_RETAIL_TIMINGS: readonly PaymentTiming[] = ["before_delivery"];

export function retailTimingOptions() {
  return PAYMENT_TIMING.filter((o) => RETAIL_TIMINGS.includes(o.id));
}

/** One sentence for the card: what customers are told about when to pay. */
export function payTimingSentence(p: Payments | null | undefined, kind: PoliciesKind): { text: string; suggested: boolean } {
  const pay = p ?? null;
  if (pay && pay.timings.length) {
    return { text: paymentsSentence({ ...pay, methods: [], note: null }), suggested: false };
  }
  if (kind === "services") {
    return { text: paymentsSentence({ ...emptyPaymentsLike(), ...timingsForServiceAnswer(SUGGESTED_SERVICE_PAY, null) }), suggested: true };
  }
  return { text: paymentsSentence({ ...emptyPaymentsLike(), timings: [...SUGGESTED_RETAIL_TIMINGS] }), suggested: true };
}

function emptyPaymentsLike(): Payments {
  return normalizePayments({ methods: [], timings: [] }) as Payments;
}

/* ---------------- Paybill ---------------- */

/** Most small paybills ask customers to use their own phone number as the account. */
export const DEFAULT_PAYBILL_ACCOUNT: PaybillAccountMode = "customer_phone";

export function paybillAccountSentence(pb: Payments["mpesa_paybill"]): string {
  const mode = pb?.account_mode ?? DEFAULT_PAYBILL_ACCOUNT;
  if (mode === "fixed") return pb?.account ? `Account number: ${pb.account}` : "Account number: not added yet";
  if (mode === "customer_name") return "Account: the customer's name";
  if (mode === "order_no") return "Account: the order or invoice number";
  return "Account: the customer's phone number";
}

/* ---------------- When unsure ---------------- */

export function unknownAnswerSentence(line: string | null | undefined): { text: string; automatic: boolean } {
  const own = String(line ?? "").trim();
  return own ? { text: own, automatic: false } : { text: UNKNOWN_ANSWER_DEFAULT_EN, automatic: true };
}

/* ---------------- Callers hear ---------------- */

export type HearLine = { key: string; label: string; text: string };

/** Everything callers are told from this page, in page order. Only what is saved, never a suggestion. */
export function callersHearLines(raw: StoredPolicies, kind: PoliciesKind, niche: NicheDef): HearLine[] {
  const bp = normalizeBusinessPolicies(raw);
  const out: HearLine[] = [];
  const pay = bp.payments ?? null;
  const trustedPay = pay && (pay.source === "owner" || pay.confirmed) && paymentsHaveContent(pay);
  const starters = starterKeys(raw);
  const payText = trustedPay ? paymentsSentence(pay) : starters.has("payment") ? "" : String(bp.payment || "").trim();
  if (payText) out.push({ key: "payment", label: "Paying", text: payText });
  for (const row of ruleRows(raw, kind, niche)) {
    if (row.state === "suggested" || !row.sentence) continue;
    out.push({ key: row.topic, label: row.label, text: row.sentence });
  }
  for (const note of hiddenNotes(raw, kind, niche)) out.push({ key: `old-${note.topic}`, label: note.label, text: note.text });
  const deposit = starters.has("deposit") ? "" : String(bp.deposit || "").trim();
  if (deposit) out.push({ key: "deposit", label: kind === "retail" ? "Holds" : "Deposits", text: deposit });
  const other = starters.has("other") ? "" : String(bp.other || "").trim();
  if (other) out.push({ key: "other", label: "Extra note", text: other });
  return out;
}

/** Preview audio takes 500 characters: whole sentences only, never cut mid-sentence. */
export const HEAR_IT_MAX = 480;
export function hearItText(lines: HearLine[]): string {
  return joinWholeSentences(lines.map((l) => (/[.!?]$/.test(l.text) ? l.text : `${l.text}.`)), HEAR_IT_MAX);
}

/* ---------------- Card patches ---------------- */

/** What one card saves. Only these keys change; everything else stays as stored. */
export type PoliciesPatch = {
  payments?: Payments | null;
  /** Registry rules per topic (null removes the topic, its spoken line and its text). */
  rules?: Partial<Record<PolicyTopic, Rule | null>>;
  /** Spoken lines put back by Undo, applied after the rules. */
  lines?: Partial<Record<PolicyTopic, Spoken | null>>;
  booking_mode?: "confirmed_slot" | "request" | "";
  holds?: Record<string, unknown> | null;
  other?: string;
  deposit?: string;
  /** Old text cleared or put back by hand, applied after the rules. */
  text?: Partial<Record<PolicyTextKey | "payment", string>>;
  /** Starter text the owner kept as their own. */
  confirm?: string[];
};

const OWNER = { source: "owner", confirmed: true } as const;
export const PATCH_TEXT_MAX = 1200;

/**
 * Apply one card's patch on top of stored business_policies. Used by the page (optimistic
 * view) and by the server action (merge onto the row read fresh). Rules go through the
 * registry so policy_lines, the rule and the shared text key move together.
 */
export function applyPoliciesPatch(input: StoredPolicies, patch: PoliciesPatch, niche: NicheDef): StoredPolicies {
  let raw: StoredPolicies = { ...(isObj(input) ? input : {}) };
  for (const [topic, rule] of Object.entries(patch.rules || {}) as Array<[PolicyTopic, Rule | null]>) {
    if (!TOPICS[topic]) continue;
    raw = applyTopicPatch(raw, topicPatch(raw, topic, rule ?? null, niche));
    const line = storedLines(raw)[topic];
    if (rule && isObj(line)) raw = { ...raw, policy_lines: { ...storedLines(raw), [topic]: withFeeAmount(line, rule) } };
  }
  if (patch.lines) {
    const lines: Record<string, unknown> = { ...storedLines(raw) };
    for (const [topic, line] of Object.entries(patch.lines)) {
      if (line && (str(line.en) || str(line.sw))) lines[topic] = { en: str(line.en), sw: str(line.sw) };
      else delete lines[topic];
    }
    raw = { ...raw, policy_lines: lines };
  }
  const p: BusinessPolicies = normalizeBusinessPolicies(raw);
  p.provenance = { ...(p.provenance || {}) };
  const own = (key: string) => {
    p.provenance![key] = { ...OWNER };
  };
  if ("payments" in patch) p.payments = patch.payments ?? null;
  if ("booking_mode" in patch) {
    p.booking_mode = patch.booking_mode ?? "";
    p.booking = { ...OWNER };
  }
  if ("holds" in patch) p.holds = patch.holds ?? undefined;
  if (typeof patch.other === "string") {
    p.other = patch.other.trim().slice(0, PATCH_TEXT_MAX);
    own("other");
  }
  if (typeof patch.deposit === "string") {
    p.deposit = patch.deposit.trim().slice(0, PATCH_TEXT_MAX);
    own("deposit");
  }
  for (const [key, value] of Object.entries(patch.text || {})) {
    p[key as PolicyTextKey] = String(value ?? "").trim().slice(0, PATCH_TEXT_MAX);
    own(key);
  }
  for (const key of patch.confirm || []) own(key);
  return businessPoliciesForStorage(p);
}

const kshAmount = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

/** The registry line says "there is a fee"; callers should hear how much when the owner set it. */
export function withFeeAmount(line: Spoken, rule: Rule): Spoken {
  const fee = typeof rule.fee_ksh === "number" && rule.fee_ksh > 0 ? rule.fee_ksh : null;
  if (!fee) return line;
  const amt = kshAmount(fee);
  if (rule.fee === "flat") {
    return {
      en: line.en.replace("After that, there is a fee.", `After that, there is a fee of ${amt}.`),
      sw: line.sw.replace("Baada ya hapo, kuna ada.", `Baada ya hapo, kuna ada ya ${amt}.`),
    };
  }
  if (rule.charge === "callout") {
    return {
      en: line.en.replace("a call-out fee applies.", `a call-out fee of ${amt} applies.`),
      sw: line.sw.replace("kuna ada ya safari.", `kuna ada ya safari ya ${amt}.`),
    };
  }
  return line;
}

/** The patch that puts back what a card changed (Undo). Starter confirms are not undone. */
export function invertPoliciesPatch(before: StoredPolicies, patch: PoliciesPatch): PoliciesPatch {
  const inv: PoliciesPatch = {};
  const bp = normalizeBusinessPolicies(before);
  if ("payments" in patch) inv.payments = bp.payments ?? null;
  const text: NonNullable<PoliciesPatch["text"]> = {};
  if (patch.rules) {
    inv.rules = {};
    inv.lines = {};
    const rules = storedRules(before);
    const lines = storedLines(before);
    for (const topic of Object.keys(patch.rules) as PolicyTopic[]) {
      inv.rules[topic] = rules[topic] ?? null;
      inv.lines[topic] = isObj(lines[topic]) ? lines[topic] : null;
      text[TEXT_KEY[topic]] = String(bp[TEXT_KEY[topic]] ?? "");
    }
  }
  for (const key of Object.keys(patch.text || {}) as Array<PolicyTextKey | "payment">) text[key] = String(bp[key] ?? "");
  if (Object.keys(text).length) inv.text = text;
  if ("booking_mode" in patch) inv.booking_mode = (bp.booking_mode as PoliciesPatch["booking_mode"]) ?? "";
  if ("holds" in patch) inv.holds = isObj(bp.holds) ? bp.holds : null;
  if (typeof patch.other === "string") inv.other = bp.other ?? "";
  if (typeof patch.deposit === "string") inv.deposit = bp.deposit ?? "";
  return inv;
}

/** Fact paths the owner confirms by saving this card (clears the Home "to check" nudge). */
export function ownerPathsForPatch(patch: PoliciesPatch): string[] {
  const out = new Set<string>();
  if ("payments" in patch) {
    out.add("policies.payment");
    out.add("payments.methods");
  }
  for (const topic of Object.keys(patch.rules || {}) as PolicyTopic[]) out.add(`policies.${TEXT_KEY[topic]}`);
  for (const key of Object.keys(patch.text || {})) out.add(`policies.${key}`);
  if ("booking_mode" in patch) out.add("policies.booking_mode");
  if ("holds" in patch) {
    out.add("policies.holds");
    out.add("policies.holds.allowed");
  }
  if (typeof patch.other === "string") out.add("policies.other");
  if (typeof patch.deposit === "string") out.add("policies.deposit");
  for (const key of patch.confirm || []) {
    out.add(`policies.${key}`);
    if (key === "payment") out.add("payments.methods");
  }
  return [...out];
}

const TOPIC_IDS = new Set<string>(POLICY_TOPICS.map((o) => o.id));
const TEXT_KEYS = new Set(["returns", "delivery", "cancellation", "warranty", "payment"]);
const CONFIRM_KEYS = new Set(["returns", "delivery", "payment", "deposit", "cancellation", "warranty", "other"]);
const RULE_FIELD_RE = /^[a-z][a-z0-9_]{0,39}$/;

function cleanRule(v: unknown): Rule | null {
  if (!isObj(v)) return null;
  const out: Rule = {};
  for (const [k, x] of Object.entries(v)) {
    if (!RULE_FIELD_RE.test(k)) continue;
    if (typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) out[k] = x;
    else if (typeof x === "string") out[k] = x.slice(0, k === "note" || k === "note_sw" ? 400 : 40);
    else if (Array.isArray(x)) out[k] = x.filter((y) => typeof y === "string").map((y) => String(y).slice(0, 40)).slice(0, 10);
    else if (x === null) out[k] = null;
  }
  return out;
}

/** Server side: keep only the keys a card may write, in the shapes it may write them. */
export function sanitizePoliciesPatch(raw: unknown): PoliciesPatch {
  const r = isObj(raw) ? raw : {};
  const out: PoliciesPatch = {};
  if ("payments" in r) out.payments = r.payments == null ? null : normalizePayments(r.payments);
  if (isObj(r.rules)) {
    out.rules = {};
    for (const [topic, rule] of Object.entries(r.rules)) if (TOPIC_IDS.has(topic)) out.rules[topic as PolicyTopic] = cleanRule(rule);
  }
  if (isObj(r.lines)) {
    out.lines = {};
    for (const [topic, line] of Object.entries(r.lines)) {
      if (!TOPIC_IDS.has(topic)) continue;
      out.lines[topic as PolicyTopic] = isObj(line) ? { en: str(line.en).slice(0, 400), sw: str(line.sw).slice(0, 400) } : null;
    }
  }
  if ("booking_mode" in r) {
    const m = String(r.booking_mode ?? "");
    out.booking_mode = m === "confirmed_slot" || m === "request" ? m : "";
  }
  if ("holds" in r) out.holds = isObj(r.holds) ? r.holds : null;
  if (typeof r.other === "string") out.other = r.other.slice(0, PATCH_TEXT_MAX);
  if (typeof r.deposit === "string") out.deposit = r.deposit.slice(0, PATCH_TEXT_MAX);
  if (isObj(r.text)) {
    out.text = {};
    for (const [k, v] of Object.entries(r.text)) if (TEXT_KEYS.has(k)) out.text[k as PolicyTextKey] = String(v ?? "").slice(0, PATCH_TEXT_MAX);
  }
  if (Array.isArray(r.confirm)) out.confirm = r.confirm.map(String).filter((k) => CONFIRM_KEYS.has(k));
  return out;
}

/** In-page targets a Home or setup link may jump to (#payments focuses the payments card). */
export const POLICIES_ANCHORS = ["payments", "pay-timing", "bookings", "holds", "rules", "other", "unsure"] as const;
export function policiesAnchor(hash: string | null | undefined): (typeof POLICIES_ANCHORS)[number] | null {
  const h = String(hash ?? "").replace(/^#/, "");
  if (h === "pay-timing") return "payments";
  return (POLICIES_ANCHORS as readonly string[]).includes(h) ? (h as (typeof POLICIES_ANCHORS)[number]) : null;
}
