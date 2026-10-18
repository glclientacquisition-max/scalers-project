import { deskRoutes, type Urls } from "../config.ts";
import type { Block, EmailSpec } from "../spec.ts";

export type Mode = "beta" | "live";
export type Ctx = { urls: Urls };

export type OwnerBase = {
  businessName: string;
  /** Owner's first name, if known. */
  firstName?: string;
  /** tenant_billing_state.mode_label: beta means nothing is charged. */
  mode: Mode;
};

export type Resource = "minutes" | "texts";

const BETA = "You're on the free beta, so nothing is charged.";
const desk = (ctx: Ctx, path: string) => `${ctx.urls.desk}${path}`;
const hi = (p: OwnerBase) => (p.firstName ? `${p.firstName}, ` : "");
const reasonOwner = (p: OwnerBase) => `You're getting this because you run ${p.businessName} on Scalers.`;
const n = (v: number) => v.toLocaleString("en-KE");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function betaNote(p: OwnerBase, extra?: string): Block[] {
  return p.mode === "beta" ? [{ t: "note", tone: "info", text: extra ? `${BETA} ${extra}` : BETA }] : [];
}

/* 1. Welcome ------------------------------------------------------------ */
export type WelcomeProps = OwnerBase & { lineReady: boolean; lineNumber?: string };
export function welcome(p: WelcomeProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: true,
    subject: `Welcome to Scalers, ${p.businessName} is set up`,
    preheader: p.lineReady ? "Your line is ready. Forward your calls and you're live." : "Your answers are saved. We'll email you when your line is ready.",
    heading: p.firstName ? `Welcome to Scalers, ${p.firstName}` : "Welcome to Scalers",
    blocks: [
      { t: "p", text: [{ strong: p.businessName }, " is set up. Your assistant now knows your services, hours and answers, and it uses them on every call it picks up."] },
      p.lineReady && p.lineNumber
        ? { t: "p", text: ["Your Scalers number is ", { strong: p.lineNumber }, ". Forward your calls to it and the assistant starts answering."] }
        : { t: "p", text: "We're getting your phone line ready. When it's live, we'll email you the number and the steps to forward your calls." },
      { t: "p", text: "Until then, look over your answers. The assistant only tells callers what you've told it, so a wrong price or missing service is worth fixing now." },
      ...betaNote(p, "We'll email you before that changes."),
    ],
    cta: { label: "Open your Desk", href: desk(ctx, deskRoutes.home) },
    secondary: { label: "Check your answers", href: desk(ctx, deskRoutes.answers) },
    reason: reasonOwner(p),
  };
}

/* 2. Line live ---------------------------------------------------------- */
export type RingSeconds = 5 | 10 | 15 | 20 | 25 | 30;
export type LineLiveProps = OwnerBase & {
  lineNumber: string;
  /** Digits for the forwarding code, 07XXXXXXXX with no spaces, e.g. 0709000000 */
  dialNumber: string;
  /** Seconds the owner's phone rings before the assistant answers. Default 20. */
  ringSeconds?: RingSeconds;
};

/** One code: busy, no answer after `s` seconds, and phone off or no signal. */
export const forwardCode = (dial: string, s: RingSeconds = 20) => `**004*${dial}**${s}#`;
/** Fallback when a network rejects the single code. */
export const forwardFallbackCodes = (dial: string, s: RingSeconds = 20) => [`**61*${dial}**${s}#`, `**67*${dial}#`, `**62*${dial}#`];
export const FORWARD_OFF_CODE = "##002#";

export function lineLive(p: LineLiveProps, ctx: Ctx): EmailSpec {
  const s = p.ringSeconds ?? 20;
  const [noAnswer, busy, off] = forwardFallbackCodes(p.dialNumber, s);
  return {
    audience: "owner",
    essential: true,
    subject: `Your Scalers line is live: ${p.lineNumber}`,
    preheader: "Dial one code on your business phone and the assistant answers the calls you miss.",
    pill: { tone: "ok", text: "Line live" },
    heading: "Your line is live",
    blocks: [
      { t: "p", text: ["Calls for ", { strong: p.businessName }, " can now be answered on your Scalers number. Your phone still rings as normal. The assistant only answers when you're busy, don't pick up, or your phone is off."] },
      { t: "stats", items: [{ value: p.lineNumber, label: "Your Scalers number" }] },
      {
        t: "steps",
        title: "Set it up in two minutes",
        items: [
          ["On the phone your customers call, open the Phone app and type ", { strong: forwardCode(p.dialNumber, s) }, ". It works on Safaricom, Airtel and Telkom."],
          "Press call. If you have two SIMs, pick the business one. Wait for the message saying it's turned on.",
          `Test it: ask a friend to call your business number and don't pick up. After about ${s} seconds the assistant should answer.`,
        ],
      },
      { t: "p", muted: true, text: [`The ${s} in the code is how many seconds your phone rings first. Change it to 15 for a quicker answer or 30 for more time to pick up.`] },
      { t: "note", tone: "info", text: ["If you see an error, dial these three instead, one at a time: ", { strong: noAnswer }, ", ", { strong: busy }, " and ", { strong: off }, ". To turn it all off, dial ", { strong: FORWARD_OFF_CODE }, "."] },
      ...betaNote(p),
    ],
    cta: { label: "Test your line", href: desk(ctx, deskRoutes.home) },
    reason: reasonOwner(p),
  };
}

/* 3. Package assigned / upgraded / downgrade scheduled ----------------- */
export type PackageProps = OwnerBase & {
  change: "assigned" | "upgraded" | "downgrade_scheduled";
  packageName: string;
  previousPackageName?: string;
  minutes: number;
  texts: number;
  seats: number;
  /** Display date: downgrade effective date, or next reset for upgrades. */
  date?: string;
};
export function packageChanged(p: PackageProps, ctx: Ctx): EmailSpec {
  const subject =
    p.change === "assigned"
      ? `You're on ${p.packageName}`
      : p.change === "upgraded"
        ? `Your plan is now ${p.packageName}`
        : `Your plan changes to ${p.packageName} on ${p.date}`;
  const lead: Block =
    p.change === "assigned"
      ? { t: "p", text: [{ strong: p.businessName }, " is on the ", { strong: p.packageName }, " plan. This is what you get each month:"] }
      : p.change === "upgraded"
        ? { t: "p", text: [{ strong: p.businessName }, " moved from ", p.previousPackageName ?? "your old plan", " to ", { strong: p.packageName }, " today. You get a share of the extra minutes and texts for the rest of this month", p.date ? `, and the full amounts from ${p.date}.` : "."] }
        : { t: "p", text: [{ strong: p.businessName }, " moves from ", p.previousPackageName ?? "your current plan", " to ", { strong: p.packageName }, " on ", { strong: p.date ?? "your next reset" }, ". Until then you keep everything on your current plan. From that date you get:"] };
  return {
    audience: "owner",
    essential: true,
    subject,
    preheader: `${n(p.minutes)} minutes, ${n(p.texts)} texts and ${p.seats} ${p.seats === 1 ? "seat" : "seats"} a month.`,
    pill: p.change === "downgrade_scheduled" ? { tone: "neutral", text: `Changes ${p.date}` } : { tone: "ok", text: "Plan active" },
    heading: subject,
    blocks: [
      lead,
      { t: "stats", items: [{ value: n(p.minutes), label: "minutes a month" }, { value: n(p.texts), label: "texts a month" }, { value: String(p.seats), label: p.seats === 1 ? "team seat" : "team seats" }] },
      ...(p.change === "assigned" ? [] : [{ t: "p", muted: true, text: "Any minutes we've added for you this month stay until your allowance resets." } as Block]),
      ...betaNote(p, "During the beta these limits are for tracking only."),
    ],
    cta: { label: "View your plan", href: desk(ctx, deskRoutes.usage) },
    reason: reasonOwner(p),
  };
}

/* 4/5. Usage 80% and 100% --------------------------------------------- */
export type UsageProps = OwnerBase & {
  resource: Resource;
  used: number;
  included: number;
  /** Display date the allowance resets, e.g. "1 November". */
  resetDate: string;
  extraUsage: boolean;
};

function whenOut(p: UsageProps, past: boolean): string {
  const keep = p.resource === "minutes" ? "calls keep being answered" : "texts keep going out";
  if (p.mode === "beta") return `${BETA} ${cap(keep)} after the allowance runs out.`;
  if (p.extraUsage) return `${past ? "Extra usage is on, so" : "When it runs out, extra usage is on, so"} ${keep}. The extra ${p.resource} are added to your next bill.`;
  return p.resource === "minutes"
    ? `${past ? "New calls aren't being answered" : "When it runs out, new calls won't be answered"} until ${p.resetDate}, unless you turn on extra usage or move to a bigger plan.`
    : `${past ? "Scalers has stopped sending texts" : "When it runs out, Scalers stops sending texts"} until ${p.resetDate}, unless you turn on extra usage or move to a bigger plan.`;
}

export function usage80(p: UsageProps, ctx: Ctx): EmailSpec {
  const pct = Math.round((p.used / Math.max(1, p.included)) * 100);
  return {
    audience: "owner",
    essential: false,
    subject: `You've used ${Math.min(pct, 99)}% of this month's ${p.resource}`,
    preheader: `${n(p.included - p.used)} ${p.resource} left until ${p.resetDate}.`,
    heading: `${hi(p)}you've used ${Math.min(pct, 99)}% of this month's ${p.resource}`.replace(/^./, (c) => c.toUpperCase()),
    blocks: [
      { t: "meter", label: cap(p.resource), used: p.used, total: p.included, unit: p.resource, detail: `${n(p.included - p.used)} left. Resets on ${p.resetDate}.` },
      { t: "p", text: [{ strong: p.businessName }, ` has used ${n(p.used)} of ${n(p.included)} ${p.resource} this month.`] },
      p.mode === "beta" ? { t: "note", tone: "info", text: whenOut(p, false) } : { t: "p", text: whenOut(p, false) },
    ],
    cta: { label: "See your usage", href: desk(ctx, deskRoutes.usage) },
    reason: reasonOwner(p),
  };
}

export function usage100(p: UsageProps, ctx: Ctx): EmailSpec {
  const offLive = p.mode === "live" && !p.extraUsage;
  return {
    audience: "owner",
    essential: true,
    subject: `You've used all of this month's ${p.resource}`,
    preheader: p.mode === "beta" ? `Nothing changes for you during the free beta. Resets on ${p.resetDate}.` : `Your ${p.resource} reset on ${p.resetDate}.`,
    pill: { tone: "attention", text: "Allowance used" },
    heading: `You've used all of this month's ${p.resource}`,
    blocks: [
      { t: "meter", label: cap(p.resource), used: p.used, total: p.included, unit: p.resource, detail: `Resets on ${p.resetDate}.` },
      p.mode === "beta"
        ? { t: "note", tone: "info", text: whenOut(p, true) }
        : offLive
          ? { t: "note", tone: "attention", text: whenOut(p, true) }
          : { t: "p", text: whenOut(p, true) },
      ...(p.mode === "live" ? [{ t: "p", muted: true, text: "If this happens most months, a bigger plan may suit you better. Reply and we'll help you pick one." } as Block] : []),
    ],
    cta: offLive ? { label: "Turn on extra usage", href: desk(ctx, deskRoutes.usage) } : { label: "See your usage", href: desk(ctx, deskRoutes.usage) },
    reason: reasonOwner(p),
  };
}

/* 6. Follow-up: still at 100% about 2 days later ----------------------- */
export type UsageReminderProps = UsageProps & { daysLeft: number; missedSince?: number };
export function usage100Reminder(p: UsageReminderProps, ctx: Ctx): EmailSpec {
  const offLive = p.mode === "live" && !p.extraUsage;
  const blocks: Block[] = [
    { t: "p", text: [{ strong: p.businessName }, ` used all of this month's ${p.resource} two days ago, and nothing has changed since. Your allowance resets in ${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}, on ${p.resetDate}.`] },
    { t: "meter", label: cap(p.resource), used: p.used, total: p.included, unit: p.resource },
  ];
  if (offLive && p.missedSince && p.resource === "minutes") {
    blocks.push({ t: "stats", items: [{ value: n(p.missedSince), label: "calls not answered since then" }] });
  }
  blocks.push(p.mode === "beta" ? { t: "note", tone: "info", text: whenOut(p, true) } : { t: "p", text: whenOut(p, true) });
  return {
    audience: "owner",
    essential: offLive,
    subject: offLive ? `Calls to ${p.businessName} aren't being answered` : `Reminder: ${p.businessName} is past this month's ${p.resource}`,
    preheader: `Resets on ${p.resetDate}. This is the only reminder we'll send.`,
    pill: { tone: "attention", text: "Still over" },
    heading: offLive && p.resource === "minutes" ? "Your calls aren't being answered" : `Still past this month's ${p.resource}`,
    blocks,
    cta: offLive ? { label: "Turn on extra usage", href: desk(ctx, deskRoutes.usage) } : { label: "See your usage", href: desk(ctx, deskRoutes.usage) },
    secondary: { label: "Reply to talk about a bigger plan", href: `mailto:${ctx.urls.support}` },
    reason: reasonOwner(p),
  };
}

/* 7. Extra usage on / off ---------------------------------------------- */
export type ExtraUsageProps = OwnerBase & { on: boolean; changedBy: string; changedAt: string };
export function extraUsage(p: ExtraUsageProps, ctx: Ctx): EmailSpec {
  const what = p.on
    ? "When your monthly minutes or texts run out, calls keep being answered and texts keep going out."
    : "When your monthly minutes or texts run out, new calls won't be answered and texts stop until your allowance resets.";
  return {
    audience: "owner",
    essential: true,
    subject: p.on ? "Extra usage is now on" : "Extra usage is now off",
    preheader: `${p.changedBy} changed this on ${p.changedAt}.`,
    pill: p.on ? { tone: "ok", text: "On" } : { tone: "neutral", text: "Off" },
    heading: p.on ? "Extra usage is now on" : "Extra usage is now off",
    blocks: [
      { t: "p", text: [{ strong: p.changedBy }, ` turned ${p.on ? "on" : "off"} extra usage for `, { strong: p.businessName }, ` on ${p.changedAt}.`] },
      { t: "p", text: what },
      p.mode === "beta"
        ? { t: "note", tone: "info", text: `${BETA} Extra usage isn't charged during the beta either.` }
        : p.on
          ? { t: "p", text: "Anything past your allowance is added to your next bill at the rates on your Usage page." }
          : { t: "p", text: "You can turn it back on at any time." },
      { t: "p", muted: true, text: "If you didn't make this change, reply to this email and we'll look into it." },
    ],
    cta: { label: "Review extra usage", href: desk(ctx, deskRoutes.usage) },
    reason: reasonOwner(p),
  };
}

/* 8. Monthly summary ---------------------------------------------------- */
export type MonthlySummaryProps = OwnerBase & {
  month: string;
  callsAnswered: number;
  requests: number;
  appointments: number;
  minutesUsed: number;
  minutesIncluded: number;
  textsUsed: number;
  textsIncluded: number;
  packageName: string;
  busiestDay?: string;
  nextResetDate: string;
};
export function monthlySummary(p: MonthlySummaryProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: false,
    subject: `Your ${p.month} on Scalers: ${n(p.callsAnswered)} calls answered`,
    preheader: `${n(p.requests)} requests and ${n(p.appointments)} appointments from your calls in ${p.month}.`,
    heading: `${p.businessName} in ${p.month}`,
    blocks: [
      { t: "p", text: `Here's what your assistant handled in ${p.month}.` },
      { t: "stats", items: [{ value: n(p.callsAnswered), label: "calls answered" }, { value: n(p.requests), label: "requests taken" }, { value: n(p.appointments), label: "appointments booked" }] },
      {
        t: "table",
        caption: "Your plan this month",
        rows: [
          { label: "Plan", value: p.packageName },
          { label: "Minutes used", value: `${n(p.minutesUsed)} of ${n(p.minutesIncluded)}`, tone: p.minutesUsed >= p.minutesIncluded ? "attention" : undefined },
          { label: "Texts sent", value: `${n(p.textsUsed)} of ${n(p.textsIncluded)}`, tone: p.textsUsed >= p.textsIncluded ? "attention" : undefined },
          ...(p.busiestDay ? [{ label: "Busiest day", value: p.busiestDay }] : []),
          { label: "Charged", value: p.mode === "beta" ? "Nothing (free beta)" : "See your bill", tone: p.mode === "beta" ? ("ok" as const) : undefined },
        ],
      },
      { t: "p", muted: true, text: `Your minutes and texts reset on ${p.nextResetDate}.` },
    ],
    cta: { label: `See ${p.month}'s calls`, href: desk(ctx, deskRoutes.calls) },
    secondary: { label: "Usage details", href: desk(ctx, deskRoutes.usage) },
    reason: reasonOwner(p),
  };
}

/* 9/10/11. Line paused, still paused, restored ------------------------- */
export type LinePausedProps = OwnerBase & { pausedOn: string; reasonText?: string; lineNumber?: string };
export function linePaused(p: LinePausedProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: true,
    subject: "Your Scalers line is paused",
    preheader: "The assistant isn't answering your calls for now. Reply and we'll help.",
    pill: { tone: "attention", text: "Paused" },
    heading: "Your line is paused",
    blocks: [
      { t: "p", text: ["We paused the Scalers line for ", { strong: p.businessName }, ` on ${p.pausedOn}. Until it's back on, the assistant won't answer calls forwarded to your Scalers number.`] },
      ...(p.reasonText ? [{ t: "table", rows: [{ label: "Reason", value: p.reasonText }] } as Block] : []),
      { t: "p", text: "Your calls, contacts and settings are all kept. Reply to this email and we'll help you get the line back on." },
      { t: "note", tone: "neutral", text: "Nothing is charged while the line is paused." },
    ],
    cta: { label: "Check line status", href: desk(ctx, deskRoutes.home) },
    reason: reasonOwner(p),
  };
}

export type LineStillPausedProps = LinePausedProps & { step: 1 | 2; daysPaused: number };
export function lineStillPaused(p: LineStillPausedProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: true,
    subject: p.step === 1 ? "Your Scalers line is still paused" : `${p.businessName}'s line has been paused for ${p.daysPaused} days`,
    preheader: p.step === 2 ? "This is our last reminder. Reply any time and we'll help." : "Callers aren't reaching your assistant. Reply and we'll help.",
    pill: { tone: "attention", text: `Paused ${p.daysPaused} days` },
    heading: "Your line is still paused",
    blocks: [
      { t: "p", text: ["The Scalers line for ", { strong: p.businessName }, ` has been paused since ${p.pausedOn}, so the assistant isn't answering your calls.`] },
      { t: "p", text: "Reply to this email and we'll sort it out with you. Your calls, contacts and settings are still here." },
      ...(p.step === 2 ? [{ t: "p", muted: true, text: "This is the last reminder we'll send about it." } as Block] : []),
      { t: "note", tone: "neutral", text: "Nothing is charged while the line is paused." },
    ],
    cta: { label: "Check line status", href: desk(ctx, deskRoutes.home) },
    secondary: { label: "Reply to talk to us", href: `mailto:${ctx.urls.support}` },
    reason: reasonOwner(p),
  };
}

export type LineRestoredProps = OwnerBase & { lineNumber: string; restoredAt: string };
export function lineRestored(p: LineRestoredProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: true,
    subject: "Your Scalers line is back on",
    preheader: `Calls to ${p.lineNumber} are being answered again.`,
    pill: { tone: "ok", text: "Line live" },
    heading: "Your line is back on",
    blocks: [
      { t: "p", text: ["Calls for ", { strong: p.businessName }, " are being answered again on ", { strong: p.lineNumber }, ` since ${p.restoredAt}.`] },
      { t: "p", text: "If you changed your call forwarding while the line was paused, turn it back on, then make a test call." },
      ...betaNote(p),
    ],
    cta: { label: "Test your line", href: desk(ctx, deskRoutes.home) },
    reason: reasonOwner(p),
  };
}

/* 12. Follow-up: unfinished setup (about 2 and 5 days) ------------------ */
export type SetupNudgeProps = OwnerBase & { step: 1 | 2; stepsDone: number; stepsTotal: number; nextStep: string };
export function setupNudge(p: SetupNudgeProps, ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: false,
    subject: p.step === 1 ? `Finish setting up ${p.businessName} on Scalers` : `Your Scalers setup is waiting`,
    preheader: `You're ${p.stepsDone} of ${p.stepsTotal} steps in. Next: ${p.nextStep}.`,
    heading: p.step === 1 ? `${hi(p)}you're nearly set up`.replace(/^./, (c) => c.toUpperCase()) : "Pick up where you left off",
    blocks: [
      { t: "meter", label: "Setup", used: p.stepsDone, total: p.stepsTotal, unit: "steps" },
      { t: "p", text: ["Your answers so far are saved. Next up: ", { strong: p.nextStep }, "."] },
      { t: "p", text: "Once setup is done, we'll get your line ready and the assistant can start answering calls you miss." },
      ...(p.step === 2 ? [{ t: "p", muted: true, text: "This is the last reminder we'll send. Stuck on something? Reply and we'll help." } as Block] : []),
      ...betaNote(p),
    ],
    cta: { label: "Continue setup", href: desk(ctx, deskRoutes.setup) },
    reason: reasonOwner(p),
  };
}

/* 13. Follow-up: invite not accepted (about 2 and 5 days) -------------- */
export type InviteReminderProps = {
  step: 1 | 2;
  businessName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  daysLeft: number;
};
export function inviteReminder(p: InviteReminderProps, _ctx: Ctx): EmailSpec {
  return {
    audience: "owner",
    essential: true,
    subject: p.step === 1 ? `Reminder: ${p.inviterName} invited you to ${p.businessName} on Scalers` : `Your invite to ${p.businessName} expires in ${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}`,
    preheader: `Join as ${p.role}. The link expires in ${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}.`,
    heading: `Join ${p.businessName} on Scalers`,
    blocks: [
      { t: "p", text: [{ strong: p.inviterName }, " invited you to join ", { strong: p.businessName }, " as ", { strong: p.role }, ". You'll see the calls, requests and appointments the assistant takes for the business."] },
      { t: "p", muted: true, text: `The link expires in ${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}. If you weren't expecting this, you can ignore it.` },
    ],
    cta: { label: "Accept invite", href: p.inviteUrl },
    reason: `${p.inviterName} invited you from ${p.businessName}'s Scalers account.`,
  };
}
