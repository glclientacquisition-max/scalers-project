import { getSupabaseAdmin } from "@/lib/supabase";
import {
  emptyPackageUsage,
  packageUsageGap,
  type PackageUsageCounters,
} from "@/lib/packageUsageAlign";

export type BillingRateCard = {
  inboundKesPerSecond: number;
  outboundKesPerSecond: number;
  whatsappKes: number;
  smsKes: number;
  emailKes: number;
  annualDiscountPercent: number;
};

export type BillingPackage = {
  id: string;
  sku: string;
  name: string;
  monthlyPriceKes: number;
  seats: number;
  minutes: number;
  sms: number;
  email: number;
  staffWa: number;
  dids: number;
  sortOrder: number;
  isActive: boolean;
};

export type TenantSubscriptionRow = {
  tenantId: string;
  businessName: string;
  packageId: string | null;
  packageName: string | null;
  period: "month" | "year" | null;
  usage: PackageUsageCounters;
  /** Set when included amounts do not equal the assigned package. */
  gap: string | null;
};

export type PackageCatalog = {
  rates: BillingRateCard;
  packages: BillingPackage[];
  businesses: TenantSubscriptionRow[];
};

/** Public landing fields only. No tenant ids, wallets, or ledger rows. */
export type PublicPackageOffer = {
  sku: string;
  name: string;
  monthlyPriceKes: number;
  annualPriceKes: number;
  seats: number;
  minutes: number;
  sms: number;
  email: number;
  staffWa: number;
  dids: number;
};

export type PublicPackageBoard = {
  discountPercent: number;
  inboundKesPerMinute: number;
  outboundKesPerMinute: number;
  smsKes: number;
  emailKes: number;
  whatsappKes: number;
  packages: PublicPackageOffer[];
};

const DEFAULT_RATES: BillingRateCard = {
  inboundKesPerSecond: 0.1,
  outboundKesPerSecond: 0.15,
  whatsappKes: 2,
  smsKes: 1,
  emailKes: 1,
  annualDiscountPercent: 17,
};

export function inboundKesPerMinute(perSecond: number): number {
  return Math.round(Number(perSecond) * 60 * 100) / 100;
}

export function outboundKesPerMinute(perSecond: number): number {
  return Math.round(Number(perSecond) * 60 * 100) / 100;
}

export function kesPerSecondFromMinute(perMinute: number): number {
  const n = Number(perMinute);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n / 60) * 100000) / 100000;
}

export function annualPriceKes(monthlyKes: number, discountPercent: number): number {
  const monthly = Math.max(0, Number(monthlyKes) || 0);
  const discount = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return Math.round(monthly * 12 * (1 - discount / 100));
}

export function parseMoney(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseDiscountPercent(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export function parseCount(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function minutesUsedFromSeconds(seconds: number): number {
  return Math.ceil(Math.max(0, Number(seconds) || 0) / 60);
}

export function remainingCount(included: number, used: number): number {
  return Math.max(0, Math.floor(Number(included) || 0) - Math.max(0, Number(used) || 0));
}

export type OwnerPackageMeter = {
  packageName: string | null;
  period: "month" | "year" | null;
  minutesIncluded: number;
  minutesUsed: number;
  smsIncluded: number;
  smsUsed: number;
  emailIncluded: number;
  emailUsed: number;
  waIncluded: number;
  waUsed: number;
  seatsIncluded: number;
  seatsUsed: number;
  rates: BillingRateCard;
};

export function emptyOwnerPackageMeter(): OwnerPackageMeter {
  return {
    packageName: null,
    period: null,
    minutesIncluded: 0,
    minutesUsed: 0,
    smsIncluded: 0,
    smsUsed: 0,
    emailIncluded: 0,
    emailUsed: 0,
    waIncluded: 0,
    waUsed: 0,
    seatsIncluded: 0,
    seatsUsed: 0,
    rates: { ...DEFAULT_RATES },
  };
}

export function inboundKesForSeconds(seconds: number, kesPerSecond = 0.1): number {
  const secs = Math.max(0, Math.ceil(Number(seconds) || 0));
  return Math.round(secs * Number(kesPerSecond) * 100) / 100;
}

export function outboundKesForSeconds(seconds: number, kesPerSecond = 0.15): number {
  const secs = Math.max(0, Math.ceil(Number(seconds) || 0));
  return Math.round(secs * Number(kesPerSecond) * 100) / 100;
}

function num(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function mapPackage(row: Record<string, unknown>): BillingPackage {
  return {
    id: String(row.id),
    sku: String(row.sku || ""),
    name: String(row.name || ""),
    monthlyPriceKes: num(row.monthly_price_kes),
    seats: num(row.seats),
    minutes: num(row.minutes),
    sms: num(row.sms),
    email: num(row.email),
    staffWa: num(row.staff_wa),
    dids: num(row.dids, 1),
    sortOrder: num(row.sort_order),
    isActive: row.is_active !== false,
  };
}

function isMissingCatalog(message: string): boolean {
  return /billing_rate_card|billing_packages|tenant_subscriptions|does not exist|schema cache/i.test(
    message
  );
}

const STRAW_OFFERS: Array<Omit<PublicPackageOffer, "annualPriceKes">> = [
  { sku: "starter", name: "Starter", monthlyPriceKes: 5000, seats: 2, minutes: 300, sms: 200, email: 100, staffWa: 200, dids: 1 },
  { sku: "growth", name: "Growth", monthlyPriceKes: 12000, seats: 5, minutes: 800, sms: 500, email: 250, staffWa: 500, dids: 1 },
  { sku: "scale", name: "Scale", monthlyPriceKes: 25000, seats: 10, minutes: 2000, sms: 1500, email: 500, staffWa: 1000, dids: 1 },
];

export function strawPublicBoard(): PublicPackageBoard {
  return {
    discountPercent: DEFAULT_RATES.annualDiscountPercent,
    inboundKesPerMinute: inboundKesPerMinute(DEFAULT_RATES.inboundKesPerSecond),
    outboundKesPerMinute: outboundKesPerMinute(DEFAULT_RATES.outboundKesPerSecond),
    smsKes: DEFAULT_RATES.smsKes,
    emailKes: DEFAULT_RATES.emailKes,
    whatsappKes: DEFAULT_RATES.whatsappKes,
    packages: STRAW_OFFERS.map((pack) => ({
      ...pack,
      annualPriceKes: annualPriceKes(pack.monthlyPriceKes, DEFAULT_RATES.annualDiscountPercent),
    })),
  };
}

/** No invented prices. Missing catalog or rate card stays blank on the public page. */
export function emptyPublicBoard(): PublicPackageBoard {
  return {
    discountPercent: 0,
    inboundKesPerMinute: 0,
    outboundKesPerMinute: 0,
    smsKes: 0,
    emailKes: 0,
    whatsappKes: 0,
    packages: [],
  };
}

export async function loadPublicPackageOffers(): Promise<PublicPackageBoard> {
  try {
    const admin = getSupabaseAdmin();
    const [ratesRes, packsRes] = await Promise.all([
      admin
        .from("billing_rate_card")
        .select(
          "inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes, annual_discount_percent"
        )
        .eq("id", 1)
        .maybeSingle(),
      admin
        .from("billing_packages")
        .select("sku, name, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids, sort_order, is_active")
        .order("sort_order", { ascending: true }),
    ]);
    if (packsRes.error || !packsRes.data?.length) return emptyPublicBoard();
    const rateRow =
      ratesRes.error || !ratesRes.data ? null : (ratesRes.data as Record<string, unknown>);
    const discountRaw = rateRow?.annual_discount_percent;
    const discount =
      rateRow && discountRaw != null && discountRaw !== ""
        ? parseDiscountPercent(discountRaw)
        : null;
    const packages = packsRes.data
      .filter((row) => row.is_active !== false)
      .map((row) => {
        const monthlyPriceKes = num(row.monthly_price_kes);
        return {
          sku: String(row.sku || ""),
          name: String(row.name || ""),
          monthlyPriceKes,
          annualPriceKes:
            discount == null ? 0 : annualPriceKes(monthlyPriceKes, discount),
          seats: num(row.seats),
          minutes: num(row.minutes),
          sms: num(row.sms),
          email: num(row.email),
          staffWa: num(row.staff_wa),
          dids: num(row.dids, 1),
        };
      })
      .filter((pack) => pack.name);
    if (!packages.length) return emptyPublicBoard();
    const money = (raw: unknown) => {
      const n = parseMoney(raw);
      return n == null ? 0 : n;
    };
    return {
      discountPercent: discount ?? 0,
      inboundKesPerMinute: rateRow ? inboundKesPerMinute(money(rateRow.inbound_kes_per_second)) : 0,
      outboundKesPerMinute: rateRow ? outboundKesPerMinute(money(rateRow.outbound_kes_per_second)) : 0,
      smsKes: rateRow ? money(rateRow.sms_kes) : 0,
      emailKes: rateRow ? money(rateRow.email_kes) : 0,
      whatsappKes: rateRow ? money(rateRow.whatsapp_kes) : 0,
      packages,
    };
  } catch {
    return emptyPublicBoard();
  }
}

const TENANT_USAGE_SELECT =
  "id, business_name, minutes_included, seconds_used, sms_included_units, sms_used_units, email_included_units, email_used_units, whatsapp_included_units, whatsapp_used_units, seat_included";

function usageFromTenant(row: Record<string, unknown>): PackageUsageCounters {
  return {
    minutesIncluded: num(row.minutes_included),
    secondsUsed: num(row.seconds_used),
    smsIncluded: num(row.sms_included_units),
    smsUsed: num(row.sms_used_units),
    emailIncluded: num(row.email_included_units),
    emailUsed: num(row.email_used_units),
    waIncluded: num(row.whatsapp_included_units),
    waUsed: num(row.whatsapp_used_units),
    seatsIncluded: num(row.seat_included),
    seatsUsed: 0,
  };
}

export async function loadPackageCatalog(): Promise<PackageCatalog> {
  const admin = getSupabaseAdmin();
  const [ratesRes, packsRes, subsRes, tenantsRes, membersRes] = await Promise.all([
    admin.from("billing_rate_card").select("*").eq("id", 1).maybeSingle(),
    admin.from("billing_packages").select("*").order("sort_order", { ascending: true }),
    admin.from("tenant_subscriptions").select("tenant_id, package_id, period"),
    admin.from("tenants").select(TENANT_USAGE_SELECT).order("business_name", { ascending: true }),
    admin.from("tenant_members").select("tenant_id"),
  ]);

  const missing = [ratesRes, packsRes, subsRes].some(
    (res) => res.error && isMissingCatalog(res.error.message)
  );
  if (missing) {
    throw new Error("Apply docs/supabase/package_catalog.sql");
  }
  if (ratesRes.error) throw ratesRes.error;
  if (packsRes.error) throw packsRes.error;
  if (subsRes.error) throw subsRes.error;

  let tenantRows: Record<string, unknown>[] = (tenantsRes.data || []) as Record<string, unknown>[];
  if (
    tenantsRes.error &&
    /minutes_included|seconds_used|whatsapp_|email_|seat_included|sms_included/i.test(tenantsRes.error.message)
  ) {
    const narrow = await admin
      .from("tenants")
      .select("id, business_name")
      .order("business_name", { ascending: true });
    if (narrow.error) throw narrow.error;
    tenantRows = (narrow.data || []) as Record<string, unknown>[];
  } else if (tenantsRes.error) {
    throw tenantsRes.error;
  }

  const seatsByTenant = new Map<string, number>();
  if (!membersRes.error) {
    for (const row of membersRes.data || []) {
      const id = String(row.tenant_id);
      seatsByTenant.set(id, (seatsByTenant.get(id) || 0) + 1);
    }
  }

  const rates = mapRates(ratesRes.data || {});

  const packages = (packsRes.data || []).map((row) => mapPackage(row as Record<string, unknown>));
  const subByTenant = new Map(
    (subsRes.data || []).map((row) => [
      String(row.tenant_id),
      { packageId: String(row.package_id), period: String(row.period) },
    ])
  );
  const packById = new Map(packages.map((pack) => [pack.id, pack]));

  const businesses: TenantSubscriptionRow[] = tenantRows.map((record) => {
    const sub = subByTenant.get(String(record.id));
    const period = sub?.period === "year" ? "year" : sub?.period === "month" ? "month" : null;
    const assigned = sub?.packageId ? packById.get(sub.packageId) || null : null;
    const usage = tenantsRes.error ? emptyPackageUsage() : usageFromTenant(record);
    usage.seatsUsed = seatsByTenant.get(String(record.id)) || 0;
    const packageName = assigned?.name || null;
    return {
      tenantId: String(record.id),
      businessName: String(record.business_name || "Business"),
      packageId: sub?.packageId || null,
      packageName,
      period,
      usage,
      gap: packageUsageGap({
        packageName: sub?.packageId ? packageName || "Package" : null,
        catalog: assigned
          ? {
              minutes: assigned.minutes,
              sms: assigned.sms,
              email: assigned.email,
              staffWa: assigned.staffWa,
              seats: assigned.seats,
            }
          : null,
        usage,
      }),
    };
  });

  return { rates, packages, businesses };
}

export async function saveRateCard(rates: BillingRateCard): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("billing_rate_card").upsert({
    id: 1,
    inbound_kes_per_second: rates.inboundKesPerSecond,
    outbound_kes_per_second: rates.outboundKesPerSecond,
    whatsapp_kes: rates.whatsappKes,
    sms_kes: rates.smsKes,
    email_kes: rates.emailKes,
    annual_discount_percent: rates.annualDiscountPercent,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function saveBillingPackage(pack: BillingPackage): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("billing_packages").upsert({
    id: pack.id,
    sku: pack.sku,
    name: pack.name.trim(),
    monthly_price_kes: pack.monthlyPriceKes,
    seats: pack.seats,
    minutes: pack.minutes,
    sms: pack.sms,
    email: pack.email,
    staff_wa: pack.staffWa,
    dids: pack.dids,
    sort_order: pack.sortOrder,
    is_active: pack.isActive,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

function mapRates(rateRow: Record<string, unknown>): BillingRateCard {
  return {
    inboundKesPerSecond: num(rateRow.inbound_kes_per_second, DEFAULT_RATES.inboundKesPerSecond),
    outboundKesPerSecond: num(rateRow.outbound_kes_per_second, DEFAULT_RATES.outboundKesPerSecond),
    whatsappKes: num(rateRow.whatsapp_kes, DEFAULT_RATES.whatsappKes),
    smsKes: num(rateRow.sms_kes, DEFAULT_RATES.smsKes),
    emailKes: num(rateRow.email_kes, DEFAULT_RATES.emailKes),
    annualDiscountPercent: num(rateRow.annual_discount_percent, DEFAULT_RATES.annualDiscountPercent),
  };
}

export async function loadBusinessPackageNames(): Promise<
  Map<string, { packageName: string; period: "month" | "year" }>
> {
  const admin = getSupabaseAdmin();
  const [subsRes, packsRes] = await Promise.all([
    admin.from("tenant_subscriptions").select("tenant_id, package_id, period"),
    admin.from("billing_packages").select("id, name"),
  ]);
  if (subsRes.error && isMissingCatalog(subsRes.error.message)) return new Map();
  if (packsRes.error && isMissingCatalog(packsRes.error.message)) return new Map();
  if (subsRes.error) throw subsRes.error;
  if (packsRes.error) throw packsRes.error;
  const names = new Map((packsRes.data || []).map((row) => [String(row.id), String(row.name || "")]));
  const out = new Map<string, { packageName: string; period: "month" | "year" }>();
  for (const row of subsRes.data || []) {
    const period = row.period === "year" ? "year" : row.period === "month" ? "month" : null;
    const packageName = names.get(String(row.package_id)) || null;
    if (!period || !packageName) continue;
    out.set(String(row.tenant_id), { packageName, period });
  }
  return out;
}

export async function loadOwnerPackageMeter(tenantId: string): Promise<OwnerPackageMeter> {
  const empty = emptyOwnerPackageMeter();
  if (!tenantId) return empty;
  try {
    const admin = getSupabaseAdmin();
    const [tenantRes, subRes, ratesRes, seatsRes] = await Promise.all([
      admin
        .from("tenants")
        .select(
          "minutes_included, seconds_used, sms_included_units, sms_used_units, email_included_units, email_used_units, whatsapp_included_units, whatsapp_used_units, seat_included"
        )
        .eq("id", tenantId)
        .maybeSingle(),
      admin.from("tenant_subscriptions").select("package_id, period").eq("tenant_id", tenantId).maybeSingle(),
      admin.from("billing_rate_card").select("*").eq("id", 1).maybeSingle(),
      admin.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    ]);

    if (tenantRes.error && /minutes_included|seconds_used|whatsapp_|email_|seat_included/i.test(tenantRes.error.message)) {
      return empty;
    }
    if (tenantRes.error) throw tenantRes.error;

    const tenant = (tenantRes.data || {}) as Record<string, unknown>;
    let packageName: string | null = null;
    let period: "month" | "year" | null = null;
    if (!subRes.error && subRes.data?.package_id) {
      period = subRes.data.period === "year" ? "year" : subRes.data.period === "month" ? "month" : null;
      const packRes = await admin
        .from("billing_packages")
        .select("name")
        .eq("id", subRes.data.package_id)
        .maybeSingle();
      if (!packRes.error) packageName = packRes.data?.name ? String(packRes.data.name) : null;
    }

    const rates =
      ratesRes.error && isMissingCatalog(ratesRes.error.message)
        ? { ...DEFAULT_RATES }
        : ratesRes.error
          ? { ...DEFAULT_RATES }
          : mapRates((ratesRes.data || {}) as Record<string, unknown>);

    return {
      packageName,
      period,
      minutesIncluded: num(tenant.minutes_included),
      minutesUsed: minutesUsedFromSeconds(num(tenant.seconds_used)),
      smsIncluded: num(tenant.sms_included_units),
      smsUsed: num(tenant.sms_used_units),
      emailIncluded: num(tenant.email_included_units),
      emailUsed: num(tenant.email_used_units),
      waIncluded: num(tenant.whatsapp_included_units),
      waUsed: num(tenant.whatsapp_used_units),
      seatsIncluded: num(tenant.seat_included),
      seatsUsed: seatsRes.count ?? 0,
      rates,
    };
  } catch {
    return empty;
  }
}

export async function assignBusinessPackage(opts: {
  tenantId: string;
  packageId: string;
  period: "month" | "year";
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc("assign_tenant_package", {
    p_tenant_id: opts.tenantId,
    p_package_id: opts.packageId,
    p_period: opts.period,
  });
  if (error) throw error;
}
