/** Plan maths from published version rows. The UI never hard-codes a price. */

export const SPLIT_PAY_KES = 150_000;
export const EXTRA_SEAT_MONTHLY_KES = 1_000;

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

/** Saved limit, or half the plan price as a display default. Does not write. */
export function spendLimitDisplayKes(
  savedKes: number | null | undefined,
  monthlyKes: number | null | undefined,
): number | null {
  if (savedKes != null && savedKes > 0) return Math.round(savedKes);
  if (monthlyKes != null && monthlyKes > 0) return Math.round(monthlyKes * 0.5);
  return null;
}
