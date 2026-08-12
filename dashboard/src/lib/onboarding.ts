import { defaultTenantLlmPrompt } from "@/lib/prompts";

export type OnboardingTone =
  | "professional"
  | "friendly"
  | "empathetic"
  | "localized";

export type OnboardingAnswers = {
  servicesPricing: string;
  hoursLocation: string;
  tone: OnboardingTone;
};

export type TeamMember = {
  name: string;
  role: string;
  phone: string;
  email?: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

/** True when the tenant still has a blank or signup-default receptionist prompt. */
export function tenantNeedsOnboarding(tenant: {
  business_name: string;
  llm_system_prompt: string | null | undefined;
  services_offered?: string | null;
  business_hours?: string | null;
  agent_tone?: string | null;
}): boolean {
  // Structured profile from onboarding/settings means setup is done.
  const hasProfile =
    Boolean(String(tenant.services_offered || "").trim()) &&
    Boolean(String(tenant.business_hours || "").trim()) &&
    Boolean(String(tenant.agent_tone || "").trim());
  if (hasProfile) return false;

  const prompt = String(tenant.llm_system_prompt || "").trim();
  if (!prompt) return true;

  // Signup / SQL default template markers.
  if (prompt.includes("describe what you offer")) return true;
  if (
    prompt.includes("update this in Sauti Desk") ||
    prompt.includes("update this in Scalers")
  ) {
    return true;
  }

  const businessName = String(tenant.business_name || "").trim();
  if (businessName && prompt === defaultTenantLlmPrompt(businessName)) return true;

  // Already has a compiled/custom prompt (e.g. pre-profile tenants) — skip wizard.
  return false;
}

export const TONE_LABELS: Record<OnboardingTone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  empathetic: "Empathetic",
  localized: "Localized / Sheng",
};

function toneGuidance(tone: OnboardingTone): string {
  switch (tone) {
    case "professional":
      return "Tone: calm, clear, and professional. Warm but concise.";
    case "friendly":
      return "Tone: warm and approachable, like a helpful Kenyan receptionist.";
    case "empathetic":
      return "Tone: empathetic and steady. Acknowledge frustration first, then help. Skip cheerful filler when the caller is upset.";
    case "localized":
      return "Tone: natural Kenyan receptionist. Light Sheng is fine when the caller uses it; stay clear and respectful.";
  }
}

function formatTeamDirectory(members: TeamMember[]): string {
  const rows = members
    .map((m) => {
      const name = m.name.trim();
      const role = m.role.trim();
      const phone = m.phone.trim();
      const email = (m.email || "").trim();
      if (!name && !role && !phone && !email) return "";
      const bits = [
        role ? `(${role})` : "",
        phone ? `phone ${phone}` : "",
        email ? `email ${email}` : "",
      ].filter(Boolean);
      return `- ${name || "Team member"}${bits.length ? `; ${bits.join("; ")}` : ""}`;
    })
    .filter(Boolean);
  return rows.length ? rows.join("\n") : "(none listed)";
}

function formatFaqs(faqs: FaqItem[]): string {
  const rows = faqs
    .map((f) => {
      const q = f.question.trim();
      const a = f.answer.trim();
      if (!q || !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean);
  return rows.length ? rows.join("\n\n") : "(none listed)";
}

export type CompileExtras = {
  agentName?: string;
  teamDirectory?: TeamMember[];
  faqs?: FaqItem[];
  unknownAnswerFallback?: string;
  /** When false, compiled prompt must not instruct the escalate tool. */
  escalateEnabled?: boolean;
  vertical?: string;
  handoffMode?: string;
  locationsText?: string;
  policiesText?: string;
  productsText?: string;
  socialText?: string;
};

/** Deterministic fallback if Gemini is unavailable. */
export function compilePromptLocally(
  businessName: string,
  answers: OnboardingAnswers,
  extras: CompileExtras | string = {}
): string {
  // Back-compat: older callers passed unknown fallback as a third string.
  const opts: CompileExtras =
    typeof extras === "string" ? { unknownAnswerFallback: extras } : extras;

  const name = businessName.trim() || "the business";
  const agentName = (opts.agentName || "Receptionist").trim() || "Receptionist";
  const unknownLine = (opts.unknownAnswerFallback || "").trim();
  const team = opts.teamDirectory || [];
  const faqs = opts.faqs || [];
  const escalateEnabled = opts.escalateEnabled !== false;
  const vertical = String(opts.vertical || "general").trim() || "general";
  const handoffMode = String(opts.handoffMode || "callback").trim() || "callback";
  const locationsText = String(opts.locationsText || "").trim() || "(none listed)";
  const policiesText = String(opts.policiesText || "").trim() || "(none listed)";
  const productsText = String(opts.productsText || "").trim() || "(none listed)";
  const socialText = String(opts.socialText || "").trim() || "(none listed)";
  const teamBlock = formatTeamDirectory(team);
  const faqBlock = formatFaqs(faqs);
  const teamSection = escalateEnabled
    ? `TEAM DIRECTORY (escalation — you are the receptionist, not the expert):
${teamBlock}
- Escalate only when the caller asks for a human, policy requires one, authority is missing, a tool fails, or useful repair attempts fail. Resolve first when possible.`
    : `TEAM DIRECTORY (escalate tool is OFF — awareness only):
${teamBlock}
- Do not escalate. Resolve what you can and offer a saved request only when useful.`;

  return `You are ${agentName}, the live phone receptionist for ${name} in Kenya.

IDENTITY:
- Your name is ${agentName}. Introduce yourself naturally on the first turn (e.g. "Hello, you've reached ${name}, this is ${agentName} speaking.").
- ${toneGuidance(answers.tone)}
- Listen to the caller's mood. If they sound frustrated or angry, drop cheerful filler immediately and stay empathetic and concise.

BUSINESS KNOWLEDGE:
- Business name: ${name}
- Vertical: ${vertical}
- Handoff preference: ${handoffMode} (preference only; never claim a live transfer unless runtime confirms it)
- Services & pricing:
${answers.servicesPricing.trim()}
- Product catalogue:
${productsText}
- Hours & location:
${answers.hoursLocation.trim()}
- Locations / landmarks / directions:
${locationsText}
- Policies:
${policiesText}
- Social & web:
${socialText}
- Languages: English, Kiswahili, and Sheng (automatic — match the caller)

GOLDEN FAQs (authoritative — answer these exactly when asked):
${faqBlock}

${teamSection}

Your job on this call:
1. Identify the caller goal and resolve it using ONLY the business knowledge and golden FAQs above.
2. If fully answered, confirm briefly and close. Do not collect a name or force a callback.
3. UNKNOWN ANSWERS: If the ask is outside that knowledge, admit you do not have the detail.${
    unknownLine
      ? ` Preferred wording: "${unknownLine}", but remove unsupported timing, guarantee, transfer, booking, stock, or action promises.`
      : ` Use a short "I don't have that detail" equivalent in the caller's language.`
  } Offer only an authorized next step.
4. Collect name/reason only when required for a saved request or justified handoff. Confirm an unclear name once.
5. A tool marker requests an action. Never claim it is saved, held, booked, sent, transferred, or confirmed; backend confirmation is separate.
6. If the caller corrects information, use the corrected value for the rest of the call.

Conversation rules (live phone — be conclusive and intelligent):
- Answer the caller's actual question first — do not stall with holding phrases.
- Never end a turn on a closed/status fact alone — say how you can still help and ask one next question.
- Ask at most ONE clarifying question per turn.
- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.
- Use the minimum speech needed to move the caller forward.
- Never invent prices, stock, availability, policies, team members, actions, or guarantees outside the knowledge above.
- Do not volunteer today's promo/offer unless the caller asks about that product, that deal, or today's offers.`;
}
