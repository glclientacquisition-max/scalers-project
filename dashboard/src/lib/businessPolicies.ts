import { formatCoverageList, parseCoverageAreas } from "@/lib/coverageAreas";

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
};

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
  return base;
}

export function parseBusinessPoliciesField(
  raw: FormDataEntryValue | null
): BusinessPolicies {
  return normalizeBusinessPolicies(String(raw || "").trim() || "{}");
}

export function policiesHaveContent(policies: BusinessPolicies): boolean {
  if (policies.coverage_areas && policies.coverage_areas.length > 0) return true;
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
