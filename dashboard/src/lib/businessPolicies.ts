import { isPackPolicyText } from "./provenance";
import { formatCoverageList, parseCoverageAreas } from "./coverageAreas";
import { cleanPayments, normalizePayments, paymentsHaveContent, paymentsSentence, validatePayments, type Payments } from "./payments";
import { normalizeRules, policyTextFromRules, validateRules, type PolicyRules } from "./policyRules";

export type BusinessPolicies = {
  returns: string;
  delivery: string;
  payment: string;
  deposit: string;
  cancellation: string;
  warranty: string;
  other: string;
  /** null until the owner saves the Coverage directory. */
  coverage_areas: string[] | null;
  /** Mirror of Locations "Yes, anywhere in Kenya" for the voice server; null when No. */
  coverage_outside?: { anywhere_kenya: true; fee_ksh: number | null } | null;
  /** Per-field owner confirm. Not spoken. */
  provenance?: Record<
    string,
    { source?: string; confirmed?: boolean; confirmed_by?: string; confirmed_at?: string }
  >;
  /** Nested hold rules. Round-tripped so a settings save does not drop them. */
  holds?: unknown;
  /** "confirmed_slot" lets the Business Assistant book a time; "request" means the owner confirms. Round-tripped. */
  booking_mode?: string;
  booking?: unknown;
  /** Typed payments (v2). The `payment` text is generated from it on save. */
  payments?: Payments | null;
  /** Typed policy rules. returns / delivery / cancellation / warranty text is generated from them. */
  rules?: PolicyRules;
  /** Keys this form does not manage (extra, field_meta, ...). Round-tripped untouched. */
  passthrough?: Record<string, unknown>;
};

/** Keys normalizeBusinessPolicies owns. Everything else rides in `passthrough`. */
const MANAGED_KEYS = new Set([
  "returns", "delivery", "payment", "deposit", "cancellation", "warranty", "other",
  "coverage_areas", "provenance", "holds", "booking_mode", "booking", "payments", "rules", "passthrough",
]);

type PolicyTextId =
  | "returns"
  | "delivery"
  | "payment"
  | "deposit"
  | "cancellation"
  | "warranty"
  | "other";

export const POLICY_FIELDS: {
  id: PolicyTextId;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "payment",
    label: "Payment",
    placeholder: "M-Pesa and cash",
  },
  {
    id: "deposit",
    label: "Holds",
    placeholder: "Hold until 6pm with a name",
  },
  {
    id: "returns",
    label: "Returns",
    placeholder: "Unused within 7 days",
  },
  {
    id: "delivery",
    label: "Delivery",
    placeholder: "Nairobi CBD, same day before 2pm",
  },
  {
    id: "cancellation",
    label: "Cancellation",
    placeholder: "Cancel 2 hours before",
  },
  {
    id: "warranty",
    label: "Warranty",
    placeholder: "30-day workmanship",
  },
  {
    id: "other",
    label: "Other",
    placeholder: "No refunds on custom orders",
  },
];

export function emptyPolicies(): BusinessPolicies {
  return {
    returns: "",
    delivery: "",
    payment: "",
    deposit: "",
    cancellation: "",
    warranty: "",
    other: "",
    coverage_areas: null,
  };
}

export function normalizeBusinessPolicies(raw: unknown): BusinessPolicies {
  const base = emptyPolicies();
  if (!raw) return base;
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return base;
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else {
    return base;
  }
  for (const field of POLICY_FIELDS) {
    base[field.id] = String(obj[field.id] ?? "").trim().slice(0, 500);
  }
  base.coverage_areas = Array.isArray(obj.coverage_areas)
    ? parseCoverageAreas(obj.coverage_areas)
    : null;
  if (obj.provenance && typeof obj.provenance === "object" && !Array.isArray(obj.provenance)) {
    base.provenance = obj.provenance as BusinessPolicies["provenance"];
  }
  if (obj.holds !== undefined) base.holds = obj.holds;
  if (typeof obj.booking_mode === "string") base.booking_mode = obj.booking_mode.slice(0, 40);
  if (obj.booking !== undefined) base.booking = obj.booking;
  // Typed payments and rules used to be dropped here, so any Settings save (Hours, FAQs...)
  // wiped them and the Payments group "reverted". Keep them, and keep unknown keys too.
  if (obj.payments !== undefined) base.payments = normalizePayments(obj.payments);
  if (obj.rules !== undefined) base.rules = normalizeRules(obj.rules);
  const passthrough: Record<string, unknown> = {};
  const nested = obj.passthrough && typeof obj.passthrough === "object" && !Array.isArray(obj.passthrough) ? (obj.passthrough as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries({ ...nested, ...obj })) if (!MANAGED_KEYS.has(k)) passthrough[k] = v;
  if (Object.keys(passthrough).length) base.passthrough = passthrough;
  return base;
}

/** Stored shape: managed keys plus the round-tripped extras at the top level again. */
export function businessPoliciesForStorage(p: BusinessPolicies): Record<string, unknown> {
  const { passthrough, ...rest } = p;
  const out: Record<string, unknown> = { ...(passthrough || {}), ...rest };
  if (out.payments === undefined) delete out.payments;
  if (out.rules === undefined) delete out.rules;
  return out;
}

export type StructuredPolicyResult = { ok: true; policies: BusinessPolicies; changedText: string[] } | { ok: false; error: string; fields: Record<string, string> };

/**
 * Settings save: validate typed payments and rules, then generate the spoken text keys
 * from them (payment, returns, delivery, cancellation, warranty) and mark those keys as
 * the owner's. Unconfirmed parsed payments keep the old payment text until confirmed.
 */
export function applyStructuredPolicies(input: BusinessPolicies): StructuredPolicyResult {
  const p: BusinessPolicies = { ...input, provenance: { ...(input.provenance || {}) } };
  const fields: Record<string, string> = {};
  const changedText: string[] = [];
  const setText = (key: "payment" | "returns" | "delivery" | "cancellation" | "warranty", value: string) => {
    const v = value.trim().slice(0, 500);
    if (p[key] === v) return;
    p[key] = v;
    p.provenance![key] = { source: "owner", confirmed: true };
    changedText.push(key);
  };
  if (p.payments) {
    const pay = cleanPayments(p.payments);
    const trusted = pay.source === "owner" || pay.confirmed;
    if (trusted) {
      Object.assign(fields, validatePayments(pay));
      p.payments = { ...pay, source: "owner", confirmed: true };
      delete p.payments.parsed_from;
      if (paymentsHaveContent(p.payments)) setText("payment", paymentsSentence(p.payments));
      else if (input.payments && paymentsHaveContent(normalizePayments(input.payments))) setText("payment", "");
    } else {
      p.payments = pay;
    }
  }
  if (p.rules) {
    const rules = normalizeRules(p.rules);
    for (const [k, v] of Object.entries(validateRules(rules))) fields[`rules.${k}`] = v;
    p.rules = rules;
    for (const [key, text] of Object.entries(policyTextFromRules(rules))) setText(key as "returns", text as string);
  }
  if (Object.keys(fields).length) return { ok: false, error: "Check the highlighted payment and policy fields.", fields };
  return { ok: true, policies: p, changedText };
}

export function parseBusinessPoliciesField(
  raw: FormDataEntryValue | null
): BusinessPolicies {
  return normalizeBusinessPolicies(String(raw || "").trim() || "{}");
}

export function policiesHaveContent(policies: BusinessPolicies): boolean {
  if (policies.coverage_areas && policies.coverage_areas.length > 0) return true;
  if (paymentsHaveContent(policies.payments ?? null)) return true;
  if (policies.rules && Object.keys(policies.rules).length) return true;
  return POLICY_FIELDS.some((field) => String(policies[field.id] || "").trim());
}

export function formatPoliciesForCompiler(policies: BusinessPolicies): string {
  const p = normalizeBusinessPolicies(policies);
  const lines: string[] = [];
  for (const field of POLICY_FIELDS) {
    const text = p[field.id];
    if (text) lines.push(`- ${field.label}: ${text}`);
  }
  if (p.coverage_areas) {
    lines.push(`- Coverage: ${formatCoverageList(p.coverage_areas) || "(none listed)"}`);
    lines.push(
      "COVERAGE RULE: The Coverage line is the only service area. Delivery text is timing and other instructions."
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structured hold rules (policies.holds). Read by tenant_hold_gate and the call brain.
// ---------------------------------------------------------------------------

export type YesNo = "yes" | "no" | "";

export type HoldRules = {
  allowed: YesNo;
  /** Longest a hold lasts, in hours. */
  max_hours: number | null;
  deposit_required: YesNo;
};

export const HOLD_HOURS_OPTIONS = [2, 6, 24, 48, 72] as const;

function yesNo(v: unknown): YesNo {
  const t = String(v ?? "").trim().toLowerCase();
  if (t === "yes" || t === "true" || t === "1") return "yes";
  if (t === "no" || t === "false" || t === "0") return "no";
  return "";
}

export function readHoldRules(holds: unknown): HoldRules {
  const h = holds && typeof holds === "object" && !Array.isArray(holds) ? (holds as Record<string, unknown>) : {};
  const hours = Number(h.max_hours);
  return {
    allowed: yesNo(h.allowed ?? h.enabled),
    max_hours: Number.isFinite(hours) && hours > 0 && hours <= 720 ? Math.round(hours) : null,
    deposit_required: yesNo(h.deposit_required),
  };
}

/** Stored shape. Marked owner so the gate treats it as the owner's own answer. */
export function holdRulesValue(rules: HoldRules): Record<string, unknown> {
  return {
    allowed: rules.allowed,
    max_hours: rules.allowed === "yes" ? rules.max_hours : null,
    deposit_required: rules.allowed === "yes" ? rules.deposit_required : "",
    source: "owner",
    confirmed: true,
  };
}

export type BookingMode = "confirmed_slot" | "request" | "";

export function readBookingMode(policies: { booking_mode?: unknown } | null | undefined): BookingMode {
  const m = String(policies?.booking_mode ?? "").trim().toLowerCase();
  return m === "confirmed_slot" || m === "request" ? m : "";
}

/** booking_mode plus the owner meta confirmedSlotEnabled reads. */
export function bookingModePatch(mode: BookingMode): { booking_mode: string; booking: Record<string, unknown> } {
  return { booking_mode: mode, booking: { source: "owner", confirmed: true } };
}

const STARTER_KEYS = [
  ["returns", "Returns"],
  ["delivery", "Delivery"],
  ["payment", "Payment"],
  ["deposit", "Deposit"],
  ["cancellation", "Cancellation"],
  ["warranty", "Warranty"],
  ["other", "Other rules"],
] as const;

export type StarterPolicyKey = (typeof STARTER_KEYS)[number][0];

/**
 * Policy text we wrote (source=seed, e.g. a roadmap backfill, or an unmarked
 * starter sentence such as Esga's delivery line) that the owner has not confirmed. The assistant does not use it as fact, so Settings shows it as
 * starter text with a keep / replace choice instead of passing it off as theirs.
 */
export function seedStarterPolicies(
  policies: BusinessPolicies
): Array<{ key: StarterPolicyKey; label: string; text: string }> {
  const prov = policies.provenance || {};
  const out: Array<{ key: StarterPolicyKey; label: string; text: string }> = [];
  for (const [key, label] of STARTER_KEYS) {
    const text = String(policies[key] || "").trim();
    if (!text) continue;
    const row = prov[key];
    if (row) {
      // Marked: seed and not confirmed is starter; anything else is the owner's.
      if (String(row.source || "").toLowerCase() !== "seed" || row.confirmed === true) continue;
    } else if (!isPackPolicyText(text)) {
      // Unmarked text is the owner's unless it is a starter sentence word for word
      // (punctuation ignored). Brain treats those as seed too, flag on or off.
      continue;
    }
    out.push({ key, label, text });
  }
  return out;
}
