import type { CreditBurns } from "../../lib/messageCredits.ts";
import type { PublicPackageBoard, PublicPackageOffer } from "../../lib/packageCatalog.ts";
import { formatKes } from "../../lib/packagePriceLabel.ts";

/** Worked example length. The cost is always computed from the live rate, never written down. */
export const EXAMPLE_MINUTES = 3;

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

export const EXTRA_USAGE_LINE =
  "Extra usage is off until you turn it on, and it stops at a spend limit you set.";

/**
 * Only past the included minutes, and only named for Starter.
 * "After your included minutes, on Starter, a 3-minute answered call costs KES 78."
 */
export function workedExample(board: PublicPackageBoard): string | null {
  const starter =
    board.packages.find((pack) => pack.sku.toLowerCase() === "starter") ||
    board.packages.find((pack) => pack.name.toLowerCase() === "starter") ||
    null;
  if (!starter || !(starter.inboundKesPerMinute > 0)) return null;
  const cost = Math.round(starter.inboundKesPerMinute * EXAMPLE_MINUTES * 100) / 100;
  return `After your included minutes, on ${starter.name}, a ${EXAMPLE_MINUTES}-minute answered call costs ${kes(cost)}`;
}

export function fitLine(minutes: number): string | null {
  const perDay = perDayMinutes(minutes);
  if (!(perDay > 0)) return null;
  return `About ${perDay.toLocaleString("en-KE")} minutes of calls a day`;
}

/** Five answers. The credit sentence uses the live burn, or leaves the numbers out. */
export function pricingFaq(burns: CreditBurns | null): Array<[string, string]> {
  const use = creditUseLine(burns);
  const credits = use
    ? `${use} Call alerts, not chats with callers.`
    : "Call alerts to you, not chats with callers.";
  return [
    ["Do unused minutes carry over?", "No. Minutes and credits reset each month."],
    ["What do message credits cover?", credits],
    ["What if I run out?", EXTRA_USAGE_LINE],
    ["Can I change package?", "Moving up applies now. Moving down starts next month."],
    ["Can I keep my number?", "Yes. Forward your calls, and dial ##002# to stop."],
  ];
}
