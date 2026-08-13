/**
 * Desk mirror of src/conversation/businessAssistantIntro.js
 * Keep rules in sync: brand-first, agent named, short grounded offering, English-default first open.
 */

export type BusinessAssistantIntroOpts = {
  businessName?: string | null;
  agentName?: string | null;
  offeringLine?: string | null;
  servicesCatalog?: Array<{ name?: string | null }> | null;
  servicesOffered?: string | null;
  servicesNotes?: string | null;
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

function formatOfferingClause(raw: string): string {
  let text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length > 96) text = `${text.slice(0, 93).trim()}...`;
  if (!/[.!?…]$/.test(text)) text = `${text}.`;
  if (!/^(we |our )/i.test(text) && text.length < 70) {
    text = `We help with ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    if (!/[.!?…]$/.test(text)) text = `${text}.`;
  }
  return text;
}

/** One short spoken clause from catalog / notes — never invent. */
export function summarizeOfferingForIntro(
  opts: Pick<
    BusinessAssistantIntroOpts,
    "offeringLine" | "servicesCatalog" | "servicesOffered" | "servicesNotes"
  > = {}
): string {
  if (opts.offeringLine != null && String(opts.offeringLine).trim()) {
    return formatOfferingClause(String(opts.offeringLine).trim());
  }

  const fromCatalog = (Array.isArray(opts.servicesCatalog)
    ? opts.servicesCatalog
    : []
  )
    .map((row) => String(row?.name || "").trim())
    .filter((name) => name && name.length <= 48)
    .slice(0, 3);

  if (fromCatalog.length) {
    let list: string;
    if (fromCatalog.length === 1) list = fromCatalog[0];
    else if (fromCatalog.length === 2)
      list = `${fromCatalog[0]} and ${fromCatalog[1]}`;
    else list = `${fromCatalog[0]}, ${fromCatalog[1]}, and ${fromCatalog[2]}`;
    const clause = /^(we |our )/i.test(list)
      ? list
      : `We help with ${list.toLowerCase()}.`;
    return formatOfferingClause(clause);
  }

  const notes = String(opts.servicesOffered || opts.servicesNotes || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!notes) return "";
  const first = notes.split(/(?<=[.!?])\s+|\n/)[0] || notes;
  if (first.length < 8 || first.length > 90) return "";
  if ((first.match(/,/g) || []).length >= 4) return "";
  return formatOfferingClause(first);
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
  const offering = summarizeOfferingForIntro(opts);
  const variant = opts.variant === 1 ? 1 : 0;

  const identityPrimary = `${opener}, you've reached ${businessName}, this is ${agentName} speaking.`;
  const identityThanks = `Thank you for calling ${businessName}, this is ${agentName} speaking.`;
  const identity = variant === 1 ? identityThanks : identityPrimary;
  const withOffer = offering ? `${identity} ${offering}` : identity;

  if (closureNotice) {
    const follow =
      afterHoursMode === "message"
        ? "I can still take a message. May I have your name?"
        : "Even so, I can still help. How can I assist?";
    return `${withOffer} ${closureNotice} ${follow}`;
  }

  if (closed && afterHoursMode === "message") {
    return `${withOffer} We're closed right now, but I can take a message.`;
  }

  if (closed) {
    return `${withOffer} We're closed now, but I can still help. How can I assist?`;
  }

  return `${withOffer} How can I help?`;
}
