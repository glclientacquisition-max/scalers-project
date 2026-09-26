import { getSupabaseAdmin } from "@/lib/supabase";

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
};

export type PackageCatalog = {
  rates: BillingRateCard;
  packages: BillingPackage[];
  businesses: TenantSubscriptionRow[];
};

const DEFAULT_RATES: BillingRateCard = {
  inboundKesPerSecond: 0.05,
  outboundKesPerSecond: 0.1,
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

export function inboundKesForSeconds(seconds: number, kesPerSecond = 0.05): number {
  const secs = Math.max(0, Math.ceil(Number(seconds) || 0));
  return Math.round(secs * Number(kesPerSecond) * 100) / 100;
}

export function outboundKesForSeconds(seconds: number, kesPerSecond = 0.1): number {
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

export async function loadPackageCatalog(): Promise<PackageCatalog> {
  const admin = getSupabaseAdmin();
  const [ratesRes, packsRes, subsRes, tenantsRes] = await Promise.all([
    admin.from("billing_rate_card").select("*").eq("id", 1).maybeSingle(),
    admin.from("billing_packages").select("*").order("sort_order", { ascending: true }),
    admin.from("tenant_subscriptions").select("tenant_id, package_id, period"),
    admin.from("tenants").select("id, business_name").order("business_name", { ascending: true }),
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
  if (tenantsRes.error) throw tenantsRes.error;

  const rateRow = ratesRes.data || {};
  const rates: BillingRateCard = {
    inboundKesPerSecond: num(rateRow.inbound_kes_per_second, DEFAULT_RATES.inboundKesPerSecond),
    outboundKesPerSecond: num(rateRow.outbound_kes_per_second, DEFAULT_RATES.outboundKesPerSecond),
    whatsappKes: num(rateRow.whatsapp_kes, DEFAULT_RATES.whatsappKes),
    smsKes: num(rateRow.sms_kes, DEFAULT_RATES.smsKes),
    emailKes: num(rateRow.email_kes, DEFAULT_RATES.emailKes),
    annualDiscountPercent: num(rateRow.annual_discount_percent, DEFAULT_RATES.annualDiscountPercent),
  };

  const packages = (packsRes.data || []).map((row) => mapPackage(row as Record<string, unknown>));
  const subByTenant = new Map(
    (subsRes.data || []).map((row) => [
      String(row.tenant_id),
      { packageId: String(row.package_id), period: String(row.period) },
    ])
  );
  const packName = new Map(packages.map((pack) => [pack.id, pack.name]));

  const businesses: TenantSubscriptionRow[] = (tenantsRes.data || []).map((row) => {
    const sub = subByTenant.get(String(row.id));
    const period = sub?.period === "year" ? "year" : sub?.period === "month" ? "month" : null;
    return {
      tenantId: String(row.id),
      businessName: String(row.business_name || "Business"),
      packageId: sub?.packageId || null,
      packageName: sub?.packageId ? packName.get(sub.packageId) || null : null,
      period,
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
