/**
 * Day-based plan proration in KSh. Twin of billing_prorate_kes and
 * billing_version_price_kes in docs/supabase/owner_billing_actions.sql.
 *
 * Nairobi calendar dates. Whole shillings. Half away from zero.
 *   days_in_period = end date - start date (at least 1)
 *   days_left = end date - today, clamped to 0..days_in_period
 *   amount = round(price * days_left / days_in_period)
 * Annual price = round(monthly * 12 * (100 - annual_discount_percent) / 100).
 * Prices are arguments. This file does not know Starter, Growth, or Scale.
 */

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function nairobiDateUtc(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  const shifted = new Date(d.getTime() + EAT_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

function roundHalfAway(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n));
}

function periodDays(start, end, now) {
  if (start == null || end == null) return { daysInPeriod: 1, daysLeft: 0 };
  const startDay = nairobiDateUtc(start);
  const endDay = nairobiDateUtc(end);
  const today = nairobiDateUtc(now == null ? new Date() : now);
  const days = Math.round((endDay - startDay) / 86400000);
  if (days < 1) return { daysInPeriod: 1, daysLeft: 0 };
  let left = Math.round((endDay - today) / 86400000);
  if (left < 0) left = 0;
  if (left > days) left = days;
  return { daysInPeriod: days, daysLeft: left };
}

function prorateKes(priceKes, daysLeft, daysInPeriod) {
  const price = Number(priceKes) || 0;
  const days = Math.round(Number(daysInPeriod) || 0);
  const left = Math.round(Number(daysLeft) || 0);
  if (price <= 0 || days <= 0 || left <= 0) return 0;
  return roundHalfAway((price * Math.min(left, days)) / days);
}

function versionPriceKes(monthlyPriceKes, period, annualDiscountPercent) {
  const monthly = Number(monthlyPriceKes) || 0;
  if (String(period || "month").toLowerCase() === "year") {
    const discount = Number(annualDiscountPercent) || 0;
    return roundHalfAway((monthly * 12 * (100 - discount)) / 100);
  }
  return roundHalfAway(monthly);
}

function prorationQuote({ currentPriceKes, newPriceKes, start, end, now }) {
  const { daysInPeriod, daysLeft } = periodDays(start, end, now);
  const creditKes = prorateKes(currentPriceKes, daysLeft, daysInPeriod);
  const chargeKes = prorateKes(newPriceKes, daysLeft, daysInPeriod);
  return {
    creditKes,
    chargeKes,
    totalKes: Math.max(chargeKes - creditKes, 0),
    daysLeft,
    daysInPeriod,
  };
}

module.exports = {
  periodDays,
  prorateKes,
  versionPriceKes,
  prorationQuote,
  roundHalfAway,
};
