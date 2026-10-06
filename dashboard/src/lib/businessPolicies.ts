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
