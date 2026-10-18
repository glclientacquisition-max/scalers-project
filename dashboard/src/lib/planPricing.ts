/** Plan maths. Prices are inputs from a package version row, never constants here. */

export const SPLIT_PAY_KES = 150_000;

export type SeatOffer = {
  /** Pinned version `extra_seat_monthly_kes`. Null hides the seat control. */
  extraSeatMonthlyKes: number | null;
  /** Seats already bought on top of the version. The RPC takes this total. */
  extraSeats: number;
  cycle: "month" | "year";
  daysLeft: number | null;
  daysInPeriod: number | null;
  /** One extra seat for this cycle, before proration. Null when the version has no seat price. */
  seatUnitKes: number | null;
  /** Long month of the period end in Africa/Nairobi, e.g. October. */
  periodEndMonth: string | null;
  /** Day the next period starts, e.g. 31 Oct. Same instant as the period end. */
  nextPeriodStartLabel: string | null;
};

export function emptySeatOffer(): SeatOffer {
  return {
    extraSeatMonthlyKes: null,
    extraSeats: 0,
    cycle: "month",
    daysLeft: null,
    daysInPeriod: null,
    seatUnitKes: null,
    periodEndMonth: null,
    nextPeriodStartLabel: null,
  };
}

export function formatKsh(amount: number): string {
  return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
}

/** Annual = round(monthly × 12 × (1 − discount/100)). Discount is a percent, 17 not 0.17. */
export function annualPriceKes(monthlyKes: number, discountPercent: number): number {
  return Math.round((monthlyKes * 12 * (100 - discountPercent)) / 100);
}

/** Stored `annual_price_kes` when the version has one. Otherwise the discount formula. */
export function annualPriceFromVersion(
  monthlyKes: number,
  discountPercent: number,
  storedKes: number | null | undefined,
): number {
  if (storedKes != null && Number.isFinite(storedKes) && storedKes >= 0) return Math.round(storedKes);
  return annualPriceKes(monthlyKes, discountPercent);
}

export function annualSavingKes(monthlyKes: number, discountPercent: number): number {
  return monthlyKes * 12 - annualPriceKes(monthlyKes, discountPercent);
}

/** Only above KSh 150,000 a year. */
export function splitPayNote(annualKes: number): string | null {
  if (!(annualKes > SPLIT_PAY_KES)) return null;
  return "Over KSh 150,000, so you can pay in parts.";
}

/**
 * Upgrade due now: (new − old) × days left ÷ days in the period.
 * `day` is the day number (day 10 of 30 leaves 20 days).
 */
export function proratedUpgradeKes(
  oldMonthlyKes: number,
  newMonthlyKes: number,
  day: number,
  daysInPeriod: number,
): number {
  const daysLeft = daysInPeriod - day;
  if (!(daysInPeriod > 0)) return 0;
  return Math.round(((newMonthlyKes - oldMonthlyKes) * daysLeft) / daysInPeriod);
}

/** A downgrade starts when the current period ends. No refund. */
export function downgradeStartsOn(periodEnd: Date): Date {
  return periodEnd;
}

/**
 * One extra seat for the pinned cycle. Monthly is the version price.
 * Yearly is that price annualized with the version discount.
 */
export function seatUnitKes(
  extraSeatMonthlyKes: number,
  cycle: "month" | "year",
  discountPercent: number,
): number {
  if (cycle === "year") return annualPriceKes(extraSeatMonthlyKes, discountPercent);
  return Math.round(extraSeatMonthlyKes);
}

/** Africa/Nairobi calendar days. `days_in_period` is end minus start, at least 1. */
export function nairobiPeriodDays(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  now: Date,
): { daysInPeriod: number; daysLeft: number } | null {
  if (!startIso || !endIso) return null;
  if (!Number.isFinite(Date.parse(startIso)) || !Number.isFinite(Date.parse(endIso))) return null;
  const start = nairobiYmd(new Date(startIso));
  const end = nairobiYmd(new Date(endIso));
  const today = nairobiYmd(now);
  if (!start || !end || !today) return null;
  const span = dayNumber(end) - dayNumber(start);
  if (!Number.isFinite(span)) return null;
  const daysInPeriod = Math.max(1, span);
  const daysLeft = Math.min(daysInPeriod, Math.max(0, dayNumber(end) - dayNumber(today)));
  return { daysInPeriod, daysLeft };
}

/** `round(amount × days left ÷ days in the period)`. */
export function proratedPortionKes(amountKes: number, daysLeft: number, daysInPeriod: number): number {
  if (!(daysInPeriod > 0)) return 0;
  const left = Math.min(daysInPeriod, Math.max(0, daysLeft));
  return Math.round((amountKes * left) / daysInPeriod);
}

const nairobiMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  month: "long",
});

/** Long month name of an instant in Africa/Nairobi. */
export function nairobiMonthName(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return nairobiMonth.format(new Date(t));
}

/**
 * Seats being added. Today is the prorated unit. Then is the version monthly
 * price times the quantity.
 */
export function seatIncreaseCopy(input: {
  quantity: number;
  monthlyKes: number;
  unitKes: number;
  daysLeft: number;
  daysInPeriod: number;
  periodMonth: string | null;
}): string | null {
  if (!(input.quantity > 0)) return null;
  const due = proratedPortionKes(input.unitKes * input.quantity, input.daysLeft, input.daysInPeriod);
  const later = Math.round(input.monthlyKes * input.quantity);
  const then = `${formatKsh(later)} a month`;
  if (!input.periodMonth) return `${formatKsh(due)} today, then ${then}.`;
  return `${formatKsh(due)} today for the rest of ${input.periodMonth}, then ${then}.`;
}

/** Plan allowances the confirm sheet compares. Same order as the plan cards. */
export type PlanAllowances = {
  minutes: number;
  seats: number;
  messageCredits: number | null;
};

function plural(n: number, one: string, many: string): string {
  return `${Math.round(n).toLocaleString("en-KE")} ${n === 1 ? one : many}`;
}

/** "300 minutes", "3 seats", "1,000 message credits". Minutes, seats, credits on every card. */
export function allowanceLines(plan: PlanAllowances): string[] {
  const lines = [plural(plan.minutes, "minute", "minutes"), plural(plan.seats, "seat", "seats")];
  if (plan.messageCredits != null) lines.push(plural(plan.messageCredits, "message credit", "message credits"));
  return lines;
}

/** Rows that change, e.g. { label: "Minutes", from: "800", to: "1,600" }. */
export function allowanceChanges(from: PlanAllowances, to: PlanAllowances): { label: string; from: string; to: string }[] {
  const n = (v: number) => Math.round(v).toLocaleString("en-KE");
  const rows: { label: string; from: string; to: string }[] = [];
  if (from.minutes !== to.minutes) rows.push({ label: "Minutes", from: n(from.minutes), to: n(to.minutes) });
  if (from.seats !== to.seats) rows.push({ label: "Seats", from: n(from.seats), to: n(to.seats) });
  if (from.messageCredits != null && to.messageCredits != null && from.messageCredits !== to.messageCredits) {
    rows.push({ label: "Message credits", from: n(from.messageCredits), to: n(to.messageCredits) });
  }
  return rows;
}

/** "KSh 11,333 today for the rest of October, then KSh 35,000 a month from 1 Nov." No arithmetic shown. */
export function planUpgradeCopy(input: {
  dueKes: number;
  laterKes: number;
  cycle: "month" | "year";
  periodMonth: string | null;
  nextPeriodStart: string | null;
}): string {
  const today = input.periodMonth
    ? `${formatKsh(input.dueKes)} today for the rest of ${input.periodMonth}`
    : `${formatKsh(input.dueKes)} today`;
  const then = `${formatKsh(input.laterKes)} ${input.cycle === "year" ? "a year" : "a month"}`;
  return `${today}, then ${then}${input.nextPeriodStart ? ` from ${input.nextPeriodStart}` : ""}.`;
}

/** "From 1 Nov: 300 minutes (now 800), 3 seats (now 8)." Only what changes. */
export function planDowngradeChanges(from: PlanAllowances, to: PlanAllowances, startLabel: string | null): string | null {
  const parts: string[] = [];
  const n = (v: number) => Math.round(v).toLocaleString("en-KE");
  if (from.minutes !== to.minutes) parts.push(`${plural(to.minutes, "minute", "minutes")} (now ${n(from.minutes)})`);
  if (from.seats !== to.seats) parts.push(`${plural(to.seats, "seat", "seats")} (now ${n(from.seats)})`);
  if (from.messageCredits != null && to.messageCredits != null && from.messageCredits !== to.messageCredits) {
    parts.push(`${plural(to.messageCredits, "message credit", "message credits")} (now ${n(from.messageCredits)})`);
  }
  if (!parts.length) return null;
  return `${startLabel ? `From ${startLabel}` : "From your next period"}: ${parts.join(", ")}.`;
}

/** "Remove 2 team members first." Null when the new plan has room. */
export function seatBlockCopy(seatsUsed: number, newSeats: number): string | null {
  const over = seatsUsed - newSeats;
  if (!(over > 0)) return null;
  return `Remove ${over} team ${over === 1 ? "member" : "members"} first.`;
}

/** Seats being removed. The new extra-seat total starts with the next period. */
export function seatReductionCopy(input: {
  seats: number;
  monthlyKes: number;
  nextPeriodStart: string | null;
}): string | null {
  if (input.seats < 0) return null;
  const later = Math.round(input.monthlyKes * input.seats);
  const pay = `${formatKsh(later)} a month for extra seats`;
  if (!input.nextPeriodStart) return `You pay ${pay}.`;
  return `From ${input.nextPeriodStart} you pay ${pay}.`;
}

/**
 * Saved limit, or the version share of the monthly price when the owner has not set one.
 * A missing share uses 50, the column default. This does not store a shilling default.
 */
export function spendLimitDisplayKes(
  savedKes: number | null | undefined,
  monthlyKes: number | null | undefined,
  sharePercent?: number | null,
): number | null {
  if (savedKes != null && savedKes > 0) return Math.round(savedKes);
  if (monthlyKes != null && monthlyKes > 0) {
    const share =
      sharePercent == null || !Number.isFinite(sharePercent) ? 50 : Math.min(100, Math.max(0, sharePercent));
    return Math.round((monthlyKes * share) / 100);
  }
  return null;
}

function nairobiYmd(date: Date): { y: number; m: number; d: number } | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = Number(parts.find((part) => part.type === "year")?.value);
  const m = Number(parts.find((part) => part.type === "month")?.value);
  const d = Number(parts.find((part) => part.type === "day")?.value);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function dayNumber(ymd: { y: number; m: number; d: number }): number {
  return Math.floor(Date.UTC(ymd.y, ymd.m - 1, ymd.d) / 86_400_000);
}
