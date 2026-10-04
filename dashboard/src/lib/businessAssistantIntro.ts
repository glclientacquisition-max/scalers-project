/**
 * Desk mirror of src/conversation/businessAssistantIntro.js
 * Keep rules in sync: shop first, named person, one help question.
 * Open and closed: no services list. Home services: English/Kiswahili invite on first open. Do not open with Habari.
 */

export const LANGUAGE_INVITE = "You can speak in English or Kiswahili.";

export type BusinessAssistantIntroOpts = {
  businessName?: string | null;
  spokenName?: string | null;
  greetingInvite?: string | null;
  agentName?: string | null;
  vertical?: string | null;
  requireLanguageInvite?: boolean;
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

function dayWordPrefix(tod: "morning" | "afternoon" | "evening"): string {
  if (tod === "morning") return "Good morning, ";
  if (tod === "evening") return "Good evening, ";
  return "";
}

function cleanName(value: unknown, fallback: string): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

const SPOKEN_NAME_MAX = 40;
const GREETING_INVITE_MAX = 80;

function clipGreetingField(value: unknown, max: number): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function isDefaultShopName(value: unknown): boolean {
  const shop = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return !shop || /^the business$/i.test(shop);
}

function spokenShopLabel(opts: BusinessAssistantIntroOpts = {}): string {
  const spoken = clipGreetingField(opts.spokenName, SPOKEN_NAME_MAX);
  if (!spoken || isDefaultShopName(spoken)) return "";
  return spoken;
}

function shopLabelForIntro(opts: BusinessAssistantIntroOpts = {}): string {
  return spokenShopLabel(opts) || cleanName(opts.businessName, "the business");
}

function customInviteText(opts: BusinessAssistantIntroOpts = {}): string {
  const invite = clipGreetingField(opts.greetingInvite, GREETING_INVITE_MAX);
  if (!invite) return "";
  const bare = invite.replace(/[.!?…]+$/g, "").trim();
  if (/^how can i help$/i.test(bare)) return "";
  return invite;
}

function greetingHelpLine(opts: BusinessAssistantIntroOpts = {}): string {
  const invite = customInviteText(opts);
  if (!invite) return "How can I help?";
  if (/[.!?…]$/.test(invite)) return invite;
  if (/^(how|what|where|when|who|which|can|could|would|may)\b/i.test(invite)) {
    return `${invite}?`;
  }
  return `${invite}.`;
}

function isDefaultAgentName(value: unknown): boolean {
  const agent = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return !agent || /^receptionist$/i.test(agent);
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

/** One short spoken clause from catalog / notes — never invent. Not spoken on first open. */
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

function composeOpenerIdentity(opts: BusinessAssistantIntroOpts = {}): string {
  const businessName = shopLabelForIntro(opts);
  const agentName = cleanName(opts.agentName, "");
  const tod = eatTimeOfDay(opts.now || new Date());
  const day = dayWordPrefix(tod);
  if (!isDefaultAgentName(agentName)) {
    if (customInviteText(opts)) {
      return `${day}${businessName}. ${agentName} here.`;
    }
    return `${day}${businessName}, this is ${agentName}.`;
  }
  return `${day}${businessName}.`;
}

/** Deterministic Test/Settings preview (shop-first English line). */
export function previewBusinessAssistantIntro(
  opts: BusinessAssistantIntroOpts = {}
): string {
  return composeBusinessAssistantIntro({
    ...opts,
    variant: 0,
    now: opts.now || new Date("2026-08-13T10:00:00.000Z"),
  });
}

function wantsLanguageInvite(opts: BusinessAssistantIntroOpts = {}): boolean {
  if (opts.requireLanguageInvite === true) return true;
  const vertical = String(opts.vertical || "").trim().toLowerCase();
  return (
    vertical === "home_services" ||
    vertical === "homeservices" ||
    vertical === "home_service"
  );
}

function languageInviteClause(opts: BusinessAssistantIntroOpts = {}): string {
  return wantsLanguageInvite(opts) ? `${LANGUAGE_INVITE} ` : "";
}

export function composeBusinessAssistantIntro(
  opts: BusinessAssistantIntroOpts = {}
): string {
  const afterHoursMode =
    String(opts.afterHoursMode || "serve").trim().toLowerCase() === "message"
      ? "message"
      : "serve";
  const closureNotice = shortenNotice(opts.closureNotice);
  const closed = opts.isOpen === false;
  const identity = composeOpenerIdentity(opts);
  const invite = languageInviteClause(opts);
  const help = greetingHelpLine(opts);
  const nameAsk = "May I have your name?";

  if (closureNotice) {
    const follow = afterHoursMode === "message" ? nameAsk : help;
    return `${identity} ${invite}${closureNotice} ${follow}`;
  }

  if (closed && afterHoursMode === "message") {
    return `${identity} ${invite}We're closed now. ${nameAsk}`;
  }

  if (closed) {
    return `${identity} ${invite}We're closed now. ${help}`;
  }

  return `${identity} ${invite}${help}`;
}
