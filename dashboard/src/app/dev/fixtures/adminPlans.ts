import type {
  BusinessPlanRow,
  PackageVersionCatalog,
  PackageVersionRow,
  VersionPackage,
} from "@/lib/packageVersionCatalog";

const FEATURES = [
  { key: "bookings", label: "Bookings" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "staff_wa", label: "Staff WhatsApp" },
] as const;

function versionRow(
  id: string,
  version: number,
  status: PackageVersionRow["status"],
  patch: Partial<PackageVersionRow> = {},
): PackageVersionRow {
  return {
    id,
    version,
    status,
    monthlyPriceKes: 5000,
    seats: 2,
    minutes: 300,
    dids: 1,
    messageCredits: 500,
    smsCreditBurn: 1,
    whatsappCreditBurn: 2,
    emailCreditBurn: 1,
    inboundKesPerSecond: 0.1,
    outboundKesPerSecond: 0.15,
    annualPriceKes: 49_800,
    annualDiscountPercent: 17,
    creditKes: 1,
    spendLimitSharePercent: 50,
    extraSeatMonthlyKes: 1500,
    trialDays: null,
    onDemandAllowed: false,
    allowancesPlaceholder: false,
    notes: null,
    features: FEATURES.map((feature) => ({ ...feature, enabled: true })),
    subscriberCount: 0,
    ...patch,
  };
}

function pack(id: string, sku: string, name: string, versions: PackageVersionRow[]): VersionPackage {
  return { id, sku, name, isActive: true, versions };
}

export const ADMIN_PLANS_CATALOG: PackageVersionCatalog = {
  packageEditorEnabled: true,
  newSignupTrialEnabled: false,
  extraSeatSupported: true,
  features: [...FEATURES],
  packages: [
    pack("pkg-trial", "trial", "Trial", [
      versionRow("ver-trial-1", 1, "published", {
        monthlyPriceKes: 0,
        minutes: 60,
        messageCredits: 100,
        trialDays: 14,
        onDemandAllowed: true,
        subscriberCount: 0,
      }),
    ]),
    pack("pkg-starter", "starter", "Starter", [
      versionRow("ver-starter-1", 1, "published", {
        monthlyPriceKes: 5000,
        minutes: 300,
        messageCredits: 500,
        subscriberCount: 18,
      }),
      versionRow("ver-starter-2", 2, "draft", {
        monthlyPriceKes: 6000,
        minutes: 360,
        messageCredits: 600,
        subscriberCount: 0,
      }),
    ]),
    pack("pkg-growth", "growth", "Growth", [
      versionRow("ver-growth-1", 1, "retired", {
        monthlyPriceKes: 10_000,
        minutes: 800,
        messageCredits: 800,
        subscriberCount: 0,
      }),
      versionRow("ver-growth-2", 2, "published", {
        monthlyPriceKes: 12_000,
        seats: 5,
        minutes: 1000,
        messageCredits: 1200,
        subscriberCount: 6,
      }),
    ]),
  ],
};

export const ADMIN_PLANS_BUSINESSES: BusinessPlanRow[] = [
  {
    tenantId: "biz-demo",
    businessName: "Sample Shop",
    billingEnforcement: "off",
    billingStatus: "beta",
    packageSku: "growth",
    packageName: "Growth",
    version: 1,
    versionId: "ver-growth-2",
    minutesIncluded: 1000,
  },
  {
    tenantId: "biz-westlands",
    businessName: "Westlands Auto",
    billingEnforcement: "soft",
    billingStatus: "beta",
    packageSku: "starter",
    packageName: "Starter",
    version: 1,
    versionId: "ver-starter-1",
    minutesIncluded: 300,
  },
  {
    tenantId: "biz-dental",
    businessName: "Kileleshwa Dental",
    billingEnforcement: "off",
    billingStatus: null,
    packageSku: null,
    packageName: null,
    version: null,
    versionId: null,
    minutesIncluded: 0,
  },
];

/** Dense catalog for Packages v2 blank-band shots (many versions fill the split). */
export const ADMIN_PACKAGES_V2_CATALOG: PackageVersionCatalog = {
  ...ADMIN_PLANS_CATALOG,
  packages: [
    ...ADMIN_PLANS_CATALOG.packages,
    ...Array.from({ length: 12 }, (_, i) =>
      pack(`pkg-extra-${i}`, `extra_${i}`, `Extra ${i + 1}`, [
        versionRow(`ver-extra-${i}-1`, 1, i % 5 === 0 ? "draft" : i % 7 === 0 ? "retired" : "published", {
          monthlyPriceKes: 3000 + i * 500,
          minutes: 120 + i * 40,
          seats: 2 + (i % 4),
          subscriberCount: (i * 3) % 17,
        }),
        versionRow(`ver-extra-${i}-2`, 2, "draft", {
          monthlyPriceKes: 3500 + i * 500,
          minutes: 160 + i * 40,
          seats: 3 + (i % 4),
          subscriberCount: 0,
        }),
      ]),
    ),
  ],
};
