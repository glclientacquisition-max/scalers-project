/** Compare a business's included counters with the assigned package. */

export type PackageBucketCatalog = {
  minutes: number;
  sms: number;
  email: number;
  staffWa: number;
  seats: number;
};

export type PackageUsageCounters = {
  minutesIncluded: number;
  secondsUsed: number;
  smsIncluded: number;
  smsUsed: number;
  emailIncluded: number;
  emailUsed: number;
  waIncluded: number;
  waUsed: number;
  seatsIncluded: number;
  seatsUsed: number;
};

export function emptyPackageUsage(): PackageUsageCounters {
  return {
    minutesIncluded: 0,
    secondsUsed: 0,
    smsIncluded: 0,
    smsUsed: 0,
    emailIncluded: 0,
    emailUsed: 0,
    waIncluded: 0,
    waUsed: 0,
    seatsIncluded: 0,
    seatsUsed: 0,
  };
}

/**
 * Null when included amounts equal the assigned package.
 * Used amounts are consumption, not a catalog mismatch.
 */
export function packageUsageGap(input: {
  packageName: string | null;
  catalog: PackageBucketCatalog | null;
  usage: PackageUsageCounters;
}): string | null {
  if (!input.packageName) return "No package";
  if (!input.catalog) return "Package is not in the catalog";

  const name = input.packageName;
  const gaps: string[] = [];
  const check = (label: string, included: number, catalog: number) => {
    if (included !== catalog) gaps.push(`${label} included ${included}, ${name} is ${catalog}`);
  };
  check("Minutes", input.usage.minutesIncluded, input.catalog.minutes);
  check("SMS", input.usage.smsIncluded, input.catalog.sms);
  check("Email", input.usage.emailIncluded, input.catalog.email);
  check("WhatsApp", input.usage.waIncluded, input.catalog.staffWa);
  check("Seats", input.usage.seatsIncluded, input.catalog.seats);
  return gaps.length ? gaps.join(". ") : null;
}

export function usedOfIncluded(used: number, included: number): string {
  const usedCount = Math.max(0, Math.floor(Number(used) || 0));
  const cap = Math.max(0, Math.floor(Number(included) || 0));
  return `${usedCount.toLocaleString("en-KE")} of ${cap.toLocaleString("en-KE")}`;
}
