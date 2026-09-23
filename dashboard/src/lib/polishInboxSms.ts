/**
 * Ticket SMS dock: tighten a draft, or suggest one packaged SMS from lived facts.
 * Distinct from polishCallerNote, which always prefixes a greeting onto a scratch note.
 */

const BLOCKED = new Set([
  "calling",
  "callings",
  "haijawekwa",
  "caller",
  "customer",
  "unknown",
]);

function firstName(raw: string): string {
  const name = String(raw || "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  if (!name || BLOCKED.has(name.toLowerCase())) return "";
  return name;
}

function packHi(name: string, business: string): string {
  const who = firstName(name);
  const biz = String(business || "").trim() || "We";
  return who ? `Hi ${who}, ${biz} here. ` : `Hi, ${biz} here. `;
}

export type InboxSmsFacts = {
  businessName: string;
  callerName: string;
  want: string;
  purpose: string;
  jobStatus: string;
  jobService: string;
  jobWhen: string;
  jobPlace: string;
  holdStatus: string;
  holdType: string;
  holdItem: string;
  holdWhen: string;
  standing: string;
};

export const POLISH_INBOX_DRAFT_SYSTEM = `Rewrite the owner's SMS draft as a clearer, shorter customer SMS.
Return only the SMS body. No quotes. No markdown. Max 320 characters.
Keep the same language as the draft (English, Swahili, Sheng, or mixed).
Kenyan business tone: clear, short, direct.
Do not add a greeting, sign-off, or business name unless the draft already has one.
Keep the meaning. Do not invent a time, price, name, or place.
Facts below are trusted. Use a name or time from the facts only when the draft already points at it.
Do not dump extra facts. Do not say booked or confirmed if the visit is only requested. Do not say ready if the hold is still open.
If the draft is already clear and short, return it with only light cleanup.`;

export const SUGGEST_INBOX_SMS_SYSTEM = `Write one customer SMS from the trusted facts.
Return only the SMS body. No quotes. No markdown. Max 320 characters.
Package: Hi {Name}, {Business} here. One fact. One true next step.
Use a real first name when given. Otherwise Hi, {Business} here.
Kenyan business tone: clear, short, direct.
Match English, Swahili, Sheng, or mixed only if the Want line is already in that language. Otherwise English.
Do not invent a time, price, name, place, or status.
If visit status is requested, never say booked or confirmed. Say the visit is logged and we will confirm shortly.
If the hold is open, never say ready.
Do not mention the desk, Inbox, Confirm, or the team internal notes.
If the facts are not enough for a useful SMS, return EMPTY.`;

export function emptyInboxSmsFacts(): InboxSmsFacts {
  return {
    businessName: "",
    callerName: "",
    want: "",
    purpose: "",
    jobStatus: "",
    jobService: "",
    jobWhen: "",
    jobPlace: "",
    holdStatus: "",
    holdType: "",
    holdItem: "",
    holdWhen: "",
    standing: "",
  };
}

export function inboxSmsFactsFromForm(formData: FormData): InboxSmsFacts {
  const clip = (key: string, max = 160) =>
    String(formData.get(key) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  return {
    businessName: clip("business_name", 80),
    callerName: firstName(clip("caller_name", 40)),
    want: clip("want"),
    purpose: clip("purpose", 24).toLowerCase(),
    jobStatus: clip("job_status", 24).toLowerCase(),
    jobService: clip("job_service"),
    jobWhen: clip("job_when", 80),
    jobPlace: clip("job_place", 80),
    holdStatus: clip("hold_status", 24).toLowerCase(),
    holdType: clip("hold_type", 24).toLowerCase(),
    holdItem: clip("hold_item"),
    holdWhen: clip("hold_when", 80),
    standing: clip("standing", 80),
  };
}

export function formatInboxSmsFacts(facts: InboxSmsFacts): string {
  const rows = [
    facts.businessName ? `Business: ${facts.businessName}` : null,
    facts.callerName ? `Customer name: ${facts.callerName}` : null,
    facts.purpose ? `Purpose: ${facts.purpose}` : null,
    facts.want ? `Want: ${facts.want}` : null,
    facts.jobStatus
      ? `Visit: status=${facts.jobStatus}; service=${facts.jobService || "none"}; when=${facts.jobWhen || "none"}; place=${facts.jobPlace || "none"}`
      : null,
    facts.holdStatus
      ? `Hold: status=${facts.holdStatus}; type=${facts.holdType || "hold"}; item=${facts.holdItem || "none"}; when=${facts.holdWhen || "none"}`
      : null,
    facts.standing ? `Standing: ${facts.standing}` : null,
  ].filter(Boolean);
  return rows.join("\n");
}

export function fallbackPolishInboxDraft(raw: string): string {
  const note = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!note) return "";
  const cased = note.charAt(0).toUpperCase() + note.slice(1);
  return cased.slice(0, 320);
}

function wantLooksInternal(want: string): boolean {
  return /confirm on desk|needs you|\binbox\b|visit request saved/i.test(want);
}

export function fallbackSuggestInboxSms(facts: InboxSmsFacts): string {
  const head = packHi(facts.callerName, facts.businessName);

  if (facts.jobStatus === "requested" && (facts.jobService || facts.jobWhen)) {
    const what = facts.jobService
      ? `your ${facts.jobService} visit`
      : "your visit";
    const when = facts.jobWhen ? ` for ${facts.jobWhen}` : "";
    return `${head}We have ${what}${when}. We will confirm shortly.`.slice(0, 320);
  }
  if (facts.jobStatus === "confirmed" && (facts.jobService || facts.jobWhen)) {
    const what = facts.jobService ? `${facts.jobService} visit` : "visit";
    const when = facts.jobWhen ? ` for ${facts.jobWhen}` : "";
    return `${head}Your ${what}${when} is confirmed.`.slice(0, 320);
  }
  if (facts.holdStatus === "open" && facts.holdType === "order" && facts.holdItem) {
    return `${head}We have your order for ${facts.holdItem}. We will confirm shortly.`.slice(
      0,
      320
    );
  }
  if (facts.holdStatus === "open" && facts.holdItem) {
    return `${head}We have held ${facts.holdItem} for you. We will confirm shortly.`.slice(
      0,
      320
    );
  }
  if (facts.purpose === "human") {
    return `${head}The team will call you back.`.slice(0, 320);
  }
  if (facts.purpose === "missed") {
    return `${head}Sorry we missed your call. We will call you back.`.slice(0, 320);
  }
  const want = facts.want;
  if (want && !wantLooksInternal(want)) {
    return `${head}${want}`.slice(0, 320);
  }
  return "";
}
