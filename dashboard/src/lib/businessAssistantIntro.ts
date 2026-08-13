/**
 * Desk mirror of src/conversation/businessAssistantIntro.js
 * Keep rules in sync: brand-first, agent named, English-default first open.
 */

export type BusinessAssistantIntroOpts = {
  businessName?: string | null;
  agentName?: string | null;
  isOpen?: boolean | null;
  afterHoursMode?: string | null;
  closureNotice?: string | null;
  /** Fixed clock for deterministic previews */
  now?: Date;
  variant?: 0 | 1;
};

function eatTimeOfDay(date: Date): "morning" | "afternoon" | "evening" {
  const hour = (date.getUTCHours() + 3) % 24;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function englishDayOpener(tod: "morning" | "afternoon" | "evening"): string {
  if (tod === "morning") return "Good morning";
  if (tod === "evening") return "Good evening";
  return "Hello";
}

function cleanName(value: unknown, fallback: string): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function shortenNotice(notice: unknown, max = 90): string {
  let short = String(notice || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!short) return "";
  if (short.length > max) short = `${short.slice(0, max - 3).trim()}...`;
  if (!/[.!?…]$/.test(short)) short = `${short}.`;
  return short;
}

/** Deterministic Test/Settings preview (primary English brand-first line). */
export function previewBusinessAssistantIntro(
  opts: BusinessAssistantIntroOpts = {}
): string {
  return composeBusinessAssistantIntro({
    ...opts,
    variant: 0,
    now: opts.now || new Date("2026-08-13T10:00:00.000Z"),
  });
}

export function composeBusinessAssistantIntro(
  opts: BusinessAssistantIntroOpts = {}
): string {
  const businessName = cleanName(opts.businessName, "the business");
  const agentName = cleanName(opts.agentName, "Receptionist");
  const tod = eatTimeOfDay(opts.now || new Date());
  const opener = englishDayOpener(tod);
  const afterHoursMode =
    String(opts.afterHoursMode || "serve").trim().toLowerCase() === "message"
      ? "message"
      : "serve";
  const closureNotice = shortenNotice(opts.closureNotice);
  const closed = opts.isOpen === false;
  const variant = opts.variant === 1 ? 1 : 0;

  const identityPrimary = `${opener}, you've reached ${businessName}, this is ${agentName} speaking.`;
  const identityThanks = `Thank you for calling ${businessName}, this is ${agentName} speaking.`;
  const identity = variant === 1 ? identityThanks : identityPrimary;

  if (closureNotice) {
    const follow =
      afterHoursMode === "message"
        ? "I can still take a message. May I have your name?"
        : "Even so, I can still help. How can I assist?";
    return `${identity} ${closureNotice} ${follow}`;
  }

  if (closed && afterHoursMode === "message") {
    return `${identity} We're closed right now, but I can take a message.`;
  }

  if (closed) {
    return `${identity} We're closed now, but I can still help. How can I assist?`;
  }

  return `${identity} How can I help?`;
}
