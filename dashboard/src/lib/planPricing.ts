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
};

export function emptySeatOffer(): SeatOffer {
  return {
    extraSeatMonthlyKes: null,
    extraSeats: 0,
    cycle: "month",
    daysLeft: null,
    daysInPeriod: null,
    seatUnitKes: null,
  };
}

export function formatKsh(amount: number): string {
  return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
}

/** Annual = round(monthly × 12 × (1 − discount/100)). Discount is a percent, 17 not 0.17. */
export function annualPriceKes(monthlyKes: number, discountPercent: number): number {
  return Math.round((monthlyKes * 12 * (100 - discountPercent)) / 100);
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

/**
 * Saved limit, or half the pinned monthly price when the owner has not set one.
 * `monthlyKes` is the version row. This does not store a shilling default.
 */
export function spendLimitDisplayKes(
  savedKes: number | null | undefined,
  monthlyKes: number | null | undefined,
): number | null {
  if (savedKes != null && savedKes > 0) return Math.round(savedKes);
  if (monthlyKes != null && monthlyKes > 0) return Math.round(monthlyKes * 0.5);
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
