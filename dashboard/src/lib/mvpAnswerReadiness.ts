/**
 * MVP readiness: can this tenant answer unanswered calls efficiently?
 * Long-term full-assist (catalogue depth, bookings) is scored as optional polish.
 */

export type MvpReadinessItem = {
  id: string;
  label: string;
  required: boolean;
  ok: boolean;
  hint?: string;
};

export type MvpReadinessInput = {
  businessName?: string | null;
  sautikitVirtualNumber?: string | null;
  llmSystemPrompt?: string | null;
  agentName?: string | null;
  agentTone?: string | null;
  businessHours?: string | null;
  hoursSchedule?: unknown;
  businessLocations?: unknown;
  faqs?: unknown;
  unknownAnswerFallback?: string | null;
  whatsappNotificationNumber?: string | null;
  alertEmail?: string | null;
  teamDirectory?: unknown;
  productCatalog?: unknown;
  vertical?: string | null;
  agentTools?: { escalate?: boolean; end_call?: boolean } | null;
};

function hasText(value: unknown, min = 1): boolean {
  return String(value || "").trim().length >= min;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasStructuredHours(schedule: unknown): boolean {
  if (!schedule || typeof schedule !== "object") return false;
  const days = (schedule as { days?: Record<string, unknown> }).days;
  if (!days || typeof days !== "object") return false;
  return Object.values(days).some(
    (day) => day && typeof day === "object" && "open" in (day as object)
  );
}

function hasLocation(locations: unknown): boolean {
  return asArray(locations).some((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    return hasText(r.landmark) || hasText(r.address) || hasText(r.directions);
  });
}

function hasFaqs(faqs: unknown): boolean {
  return asArray(faqs).some((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    return hasText(r.question) && hasText(r.answer);
  });
}

function hasTeamCatchAll(team: unknown): boolean {
  return asArray(team).some((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    const role = String(r.role || "").toLowerCase();
    return (
      hasText(r.name) &&
      (role.includes("general") || role.includes("owner") || role.includes("ceo"))
    );
  });
}

function hasDid(raw: unknown): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  if (/^pending:/i.test(value)) return false;
  return true;
}

function hasNotify(wa: unknown, email: unknown): boolean {
  return hasText(wa, 8) || hasText(email, 5);
}

function hasProducts(catalog: unknown): boolean {
  return asArray(catalog).some((row) => {
    if (!row || typeof row !== "object") return false;
    return hasText((row as { name?: unknown }).name);
  });
}

/**
 * Score whether a tenant can efficiently answer unanswered calls (MVP job).
 * Catalogue is recommended for retail but not required to answer hours/FAQ/message.
 */
export function assessMvpAnswerReadiness(
  input: MvpReadinessInput
): {
  ready: boolean;
  score: number;
  requiredOk: number;
  requiredTotal: number;
  items: MvpReadinessItem[];
} {
  const vertical = String(input.vertical || "general").toLowerCase();
  const retail = vertical === "retail";

  const items: MvpReadinessItem[] = [
    {
      id: "did",
      label: "Live phone number assigned",
      required: true,
      ok: hasDid(input.sautikitVirtualNumber),
      hint: "Assign a DID from the pool before callers can reach the receptionist.",
    },
    {
      id: "prompt",
      label: "Receptionist prompt compiled",
      required: true,
      ok: hasText(input.llmSystemPrompt, 80),
      hint: "Finish onboarding or save + compile in Settings.",
    },
    {
      id: "identity",
      label: "Agent name and tone",
      required: true,
      ok: hasText(input.agentName) && hasText(input.agentTone),
    },
    {
      id: "hours",
      label: "Business hours on file",
      required: true,
      ok: hasText(input.businessHours, 8) || hasStructuredHours(input.hoursSchedule),
    },
    {
      id: "hours_schedule",
      label: "Structured open/closed schedule",
      required: false,
      ok: hasStructuredHours(input.hoursSchedule),
      hint: "Use Mon–Sat 9:00 AM – 7:00 PM style text so open/closed is automatic.",
    },
    {
      id: "location",
      label: "Location / landmark",
      required: true,
      ok: hasLocation(input.businessLocations),
    },
    {
      id: "faqs_or_fallback",
      label: "FAQs or unknown-answer line",
      required: true,
      ok: hasFaqs(input.faqs) || hasText(input.unknownAnswerFallback, 12),
    },
    {
      id: "notify",
      label: "Owner notify (WhatsApp or email)",
      required: true,
      ok: hasNotify(input.whatsappNotificationNumber, input.alertEmail),
      hint: "Needed so messages, holds, and escalations reach the business.",
    },
    {
      id: "team",
      label: "Escalation catch-all teammate",
      required: false,
      ok: hasTeamCatchAll(input.teamDirectory),
      hint: "Add General queries / owner so “talk to a human” routes cleanly.",
    },
    {
      id: "catalogue",
      label: retail
        ? "Product catalogue (retail)"
        : "Product catalogue (optional)",
      required: false,
      ok: hasProducts(input.productCatalog),
      hint: retail
        ? "Upload titles in Train for price/hold/order — blank prices are OK."
        : "Optional until you sell discrete products.",
    },
  ];

  const required = items.filter((i) => i.required);
  const requiredOk = required.filter((i) => i.ok).length;
  const optional = items.filter((i) => !i.required);
  const optionalOk = optional.filter((i) => i.ok).length;
  const score =
    required.length + optional.length === 0
      ? 0
      : Math.round(
          ((requiredOk + optionalOk * 0.5) /
            (required.length + optional.length * 0.5)) *
            100
        );

  return {
    ready: required.every((i) => i.ok),
    score,
    requiredOk,
    requiredTotal: required.length,
    items,
  };
}
