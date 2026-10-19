import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withPublishedPackagePrices, type PublishedVersionPrice } from "../dashboard/src/lib/publishedPackagePrice.ts";

const packages = [
  { id: "growth", sku: "growth", monthlyPriceKes: 12000, minutes: 800 },
  { id: "scale", sku: "scale", monthlyPriceKes: 25000, minutes: 2000 },
  { id: "starter", sku: "starter", monthlyPriceKes: 5000, minutes: 300 },
];

const versions: PublishedVersionPrice[] = [
  { packageId: "growth", version: 1, status: "published", monthlyPriceKes: 12000, annualPriceKes: 119520, minutes: 800 },
  { packageId: "growth", version: 2, status: "published", monthlyPriceKes: 18000, annualPriceKes: 194400, minutes: 800 },
  { packageId: "growth", version: 3, status: "draft", monthlyPriceKes: 1, annualPriceKes: 1, minutes: 1 },
  { packageId: "scale", version: 1, status: "published", monthlyPriceKes: 25000, annualPriceKes: 249000, minutes: 2000 },
  { packageId: "scale", version: 2, status: "published", monthlyPriceKes: 35000, annualPriceKes: 378000, minutes: 1600 },
];

describe("published package prices", () => {
  it("uses the latest published annual price, not the rate-card discount", () => {
    const priced = withPublishedPackagePrices(packages, versions);
    const growth = priced.find((pack) => pack.id === "growth");
    const scale = priced.find((pack) => pack.id === "scale");
    const starter = priced.find((pack) => pack.id === "starter");
    assert.equal(growth?.monthlyPriceKes, 18000);
    assert.equal(growth?.annualPriceKes, 194400);
    assert.equal(scale?.monthlyPriceKes, 35000);
    assert.equal(scale?.annualPriceKes, 378000);
    assert.equal(scale?.minutes, 1600);
    assert.equal(starter?.monthlyPriceKes, 0);
    assert.equal(starter?.annualPriceKes, 0);
  });
});