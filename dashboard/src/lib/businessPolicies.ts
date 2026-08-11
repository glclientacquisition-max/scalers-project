export type BusinessPolicies = {
  returns: string;
  delivery: string;
  payment: string;
  deposit: string;
  cancellation: string;
  warranty: string;
  other: string;
};

export const POLICY_FIELDS: {
  id: keyof BusinessPolicies;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "payment",
    label: "Payment",
    placeholder: "e.g. M-Pesa and cash. Cards on request.",
  },
  {
    id: "returns",
    label: "Returns / exchanges",
    placeholder: "e.g. Unused items within 7 days with receipt.",
  },
  {
    id: "delivery",
    label: "Delivery / service area",
    placeholder: "e.g. Delivery in Nairobi CBD; same-day before 2pm.",
  },
  {
    id: "deposit",
    label: "Deposits / holds",
    placeholder: "e.g. We can hold items until evening with a name.",
  },
  {
    id: "cancellation",
    label: "Cancellation",
    placeholder: "e.g. Cancel bookings 2 hours before the visit.",
  },
  {
    id: "warranty",
    label: "Warranty / guarantee",
    placeholder: "e.g. 30-day workmanship warranty on repairs.",
  },
  {
    id: "other",
    label: "Other policy",
    placeholder: "Anything else callers ask about often.",
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
  for (const key of Object.keys(base) as (keyof BusinessPolicies)[]) {
    base[key] = String(obj[key] ?? "").trim().slice(0, 500);
  }
  return base;
}

export function parseBusinessPoliciesField(
  raw: FormDataEntryValue | null
): BusinessPolicies {
  return normalizeBusinessPolicies(String(raw || "").trim() || "{}");
}

export function policiesHaveContent(policies: BusinessPolicies): boolean {
  return Object.values(policies).some((v) => String(v || "").trim());
}

export function formatPoliciesForCompiler(policies: BusinessPolicies): string {
  const p = normalizeBusinessPolicies(policies);
  const lines: string[] = [];
  for (const field of POLICY_FIELDS) {
    const text = p[field.id];
    if (text) lines.push(`- ${field.label}: ${text}`);
  }
  return lines.join("\n");
}
