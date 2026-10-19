/** Monthly and yearly prices from the latest published package version. Not the rate card. */

export type PublishedVersionPrice = {
  packageId: string;
  version: number;
  status: string;
  monthlyPriceKes: number;
  annualPriceKes: number;
  minutes: number;
};

export function latestPublishedPackagePrice(rows: PublishedVersionPrice[]): Map<string, PublishedVersionPrice> {
  const latest = new Map<string, PublishedVersionPrice>();
  for (const row of rows) {
    if (row.status !== "published") continue;
    const prev = latest.get(row.packageId);
    if (!prev || row.version > prev.version) latest.set(row.packageId, row);
  }
  return latest;
}

export function withPublishedPackagePrices<T extends { id: string; monthlyPriceKes: number; minutes: number }>(
  packages: T[],
  rows: PublishedVersionPrice[],
): (T & { annualPriceKes: number })[] {
  const latest = latestPublishedPackagePrice(rows);
  return packages.map((pack) => {
    const published = latest.get(pack.id);
    if (!published) return { ...pack, monthlyPriceKes: 0, annualPriceKes: 0 };
    return {
      ...pack,
      monthlyPriceKes: published.monthlyPriceKes,
      annualPriceKes: published.annualPriceKes,
      minutes: published.minutes,
    };
  });
}
