import type { CreditBurns } from "../../lib/messageCredits.ts";
import type { PublicPackageBoard, PublicPackageOffer } from "../../lib/packageCatalog.ts";
import { formatKes } from "../../lib/packagePriceLabel.ts";
import { spendLimitDisplayKes } from "../../lib/planPricing.ts";

/** Day price and "minutes a day" use a 30-day month. The page does not invent a calendar. */
export const BILLING_MONTH_DAYS = 30;

const PLAN_ORDER = ["starter", "growth", "scale"];

export const kes = (n: number) => `KES ${formatKes(n)}`;

export function perDayKes(monthlyPriceKes: number): number {
  if (!(monthlyPriceKes > 0)) return 0;
  return Math.round(monthlyPriceKes / BILLING_MONTH_DAYS);
}

export function perDayMinutes(minutes: number): number {
  if (!(minutes > 0)) return 0;
  return Math.round(minutes / BILLING_MONTH_DAYS);
}

/** Starter, then Growth, then Scale. Anything else stays after those three. */
export function orderPublicPacks(packs: readonly PublicPackageOffer[]): PublicPackageOffer[] {
  return packs.toSorted((a, b) => rank(a) - rank(b));
}

function rank(pack: PublicPackageOffer): number {
  const at = PLAN_ORDER.indexOf(pack.sku.toLowerCase());
  return at === -1 ? PLAN_ORDER.length : at;
}

/** Three priced plans. Named skus win when they are present. */
export function plansForPage(board: PublicPackageBoard): PublicPackageOffer[] {
  const priced = board.packages.filter((pack) => pack.monthlyPriceKes > 0);
  const named = orderPublicPacks(priced.filter((pack) => PLAN_ORDER.includes(pack.sku.toLowerCase())));
  return (named.length ? named : orderPublicPacks(priced)).slice(0, 3);
}

export function isGrowthPlan(pack: PublicPackageOffer): boolean {
  return pack.sku.toLowerCase() === "growth" || pack.name.toLowerCase() === "growth";
}

/** Same burn on every plan that shows credits. Otherwise the page does not invent a ratio. */
export function sharedCreditBurns(packs: readonly PublicPackageOffer[]): CreditBurns | null {
  const withCredits = packs.filter((pack) => pack.messageCredits != null);
  if (!withCredits.length) return null;
  const burns = withCredits.map((pack) => pack.creditBurns);
  if (burns.some((row) => !row)) return null;
  const first = burns[0];
  if (!first) return null;
  const same = burns.every(
    (row) => row && row.sms === first.sms && row.email === first.email && row.whatsapp === first.whatsapp,
  );
  return same ? first : null;
}

/** "SMS or email uses 1 credit. WhatsApp uses 2 credits." Numbers come from the version burns. */
export function creditUseLine(burns: CreditBurns | null): string | null {
  if (!burns || !(burns.sms > 0) || !(burns.email > 0) || !(burns.whatsapp > 0)) return null;
  if (burns.sms === burns.email) {
    return `SMS or email uses ${countWord(burns.sms)}. WhatsApp uses ${countWord(burns.whatsapp)}.`;
  }
  return `SMS uses ${countWord(burns.sms)}. Email uses ${countWord(burns.email)}. WhatsApp uses ${countWord(burns.whatsapp)}.`;
}

function countWord(n: number): string {
  const shown = Number.isInteger(n) ? String(n) : formatKes(n);
  return `${shown} ${n === 1 ? "credit" : "credits"}`;
}

export function fitLine(minutes: number): string | null {
  const perDay = perDayMinutes(minutes);
  if (!(perDay > 0)) return null;
  return `About ${perDay.toLocaleString("en-KE")} minutes of calls a day`;
}

/** Same spend-limit share on every plan. Null when any version omits it or they differ. */
export function sharedSpendShare(packs: readonly PublicPackageOffer[]): number | null {
  if (!packs.length) return null;
  const first = packs[0]?.spendLimitSharePercent;
  if (first == null) return null;
  return packs.every((pack) => pack.spendLimitSharePercent === first) ? first : null;
}

/** One block under the cards. Figures stay on the cards. The half-price line only when every version says 50. */
export function billingLines(packs: readonly PublicPackageOffer[]): string[] {
  const limit =
    sharedSpendShare(packs) === 50
      ? "It stops at half your monthly price, unless you set another limit."
      : "It stops at your spend limit.";
  return [
    "Minutes and credits reset each month. Nothing carries over.",
    "Extra usage stays off until you turn it on.",
    limit,
    "Past your minutes, calls are billed by the second.",
    "Moving up starts now. Moving down starts next month.",
  ];
}

export type MonthCost = {
  sku: string;
  name: string;
  totalKes: number;
  extraKes: number;
  unanswered: number;
};

/**
 * Package price plus extra minutes at that version's rate.
 * Extra usage off: minutes past the plan are not answered.
 * Extra usage on: billed minutes stop at the spend limit (version share, or the column default).
 */
export function monthCost(pack: PublicPackageOffer, minutes: number, extraOn: boolean): MonthCost {
  const used = Math.max(0, Math.floor(Number(minutes) || 0));
  const over = Math.max(0, used - Math.max(0, pack.minutes));
  const rate = pack.inboundKesPerMinute;
  const cap = spendLimitDisplayKes(null, pack.monthlyPriceKes, pack.spendLimitSharePercent) ?? 0;
  let extraKes = 0;
  let unanswered = 0;
  if (over > 0) {
    if (extraOn && rate > 0) {
      const affordable = cap > 0 ? Math.floor(cap / rate) : over;
      const billed = Math.min(over, affordable);
      extraKes = Math.round(billed * rate * 100) / 100;
      unanswered = over - billed;
    } else {
      unanswered = over;
    }
  }
  return {
    sku: pack.sku,
    name: pack.name,
    totalKes: Math.round((pack.monthlyPriceKes + extraKes) * 100) / 100,
    extraKes,
    unanswered,
  };
}

/** Lowest total among plans that answer every typed minute. */
export function lowestThatAnswers(rows: readonly MonthCost[]): MonthCost | null {
  const full = rows.filter((row) => row.unanswered === 0);
  if (!full.length) return null;
  return full.reduce((best, row) => (row.totalKes < best.totalKes ? row : best));
}

/** Five objections. Credit numbers come from the version burns. */
export function pricingFaq(burns: CreditBurns | null): Array<[string, string]> {
  const use = creditUseLine(burns);
  const credits = use
    ? `${use} Call alerts, not chats with callers.`
    : "Call alerts to you, not chats with callers.";
  return [
    [
      "What happens when my minutes run out?",
      "Calls stop until the month ends. Turn extra usage on to keep going, up to your spend limit.",
    ],
    ["Can I keep my number?", "Yes. Forward your calls, and dial ##002# to stop."],
    ["What counts as a message credit?", credits],
    ["Can I change plan?", "Moving up starts now. Moving down starts next month."],
    ["How does annual billing work?", "You pay the year's price once. Minutes and credits still reset each month."],
  ];
}
