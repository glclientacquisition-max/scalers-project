/** Wizard draft persisted in localStorage so refresh/Back never loses owner input. */
export const ONBOARDING_DRAFT_KEY = "scalers.onboarding.draft.v1";

export type OnboardingDraft = {
  step: number;
  vertical: string;
  products: Array<{ name: string; category: string; price: string; notes: string }>;
  services: Array<{ name: string; pricing_mode: string; site_visit: string; notes: string }>;
  faqAnswers: Record<string, string>;
  hoursLocation: string;
  landmark: string;
  directions: string;
  tone: string;
  handoffMode: string;
  agentName: string;
};

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseOnboardingDraft(raw: string | null): Partial<OnboardingDraft> | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const rows = (v: unknown) => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object").slice(0, 200) : []);
  const step = Number(d.step);
  return {
    step: Number.isInteger(step) && step >= 0 && step <= 3 ? step : 0,
    vertical: str(d.vertical, 40),
    products: rows(d.products).map((r) => {
      const o = r as Record<string, unknown>;
      return { name: str(o.name, 200), category: str(o.category, 200), price: str(o.price, 100), notes: str(o.notes) };
    }),
    services: rows(d.services).map((r) => {
      const o = r as Record<string, unknown>;
      return { name: str(o.name, 200), pricing_mode: str(o.pricing_mode, 20), site_visit: str(o.site_visit, 5), notes: str(o.notes) };
    }),
    faqAnswers:
      d.faqAnswers && typeof d.faqAnswers === "object"
        ? Object.fromEntries(Object.entries(d.faqAnswers as Record<string, unknown>).map(([k, v]) => [k, str(v)]))
        : {},
    hoursLocation: str(d.hoursLocation, 300),
    landmark: str(d.landmark, 300),
    directions: str(d.directions),
    tone: str(d.tone, 40),
    handoffMode: str(d.handoffMode, 40),
    agentName: str(d.agentName, 60),
  };
}

/** Receptionist name: required, 1-40 chars. */
export function validateAgentName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? "").trim();
  if (!name) return { ok: false, error: "Give your receptionist a name." };
  if (name.length > 40) return { ok: false, error: "Receptionist name is too long (40 max)." };
  return { ok: true, name };
}
