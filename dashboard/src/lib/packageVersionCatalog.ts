import { getSupabaseAdmin } from "@/lib/supabase";

export type VersionFeature = { key: string; label: string; enabled: boolean };

export type PackageVersionRow = {
  id: string;
  version: number;
  status: "draft" | "published" | "retired";
  monthlyPriceKes: number;
  seats: number;
  minutes: number;
  dids: number;
  messageCredits: number | null;
  smsCreditBurn: number | null;
  whatsappCreditBurn: number | null;
  emailCreditBurn: number | null;
  inboundKesPerSecond: number;
  outboundKesPerSecond: number;
  annualDiscountPercent: number;
  trialDays: number | null;
  onDemandAllowed: boolean;
  allowancesPlaceholder: boolean;
  notes: string | null;
  features: VersionFeature[];
  subscriberCount: number;
};

export type VersionPackage = {
  id: string;
  sku: string;
  name: string;
  isActive: boolean;
  versions: PackageVersionRow[];
};

export type PackageVersionCatalog = {
  packageEditorEnabled: boolean;
  newSignupTrialEnabled: boolean;
  features: { key: string; label: string }[];
  packages: VersionPackage[];
};

export type BusinessPlanRow = {
  tenantId: string;
  businessName: string;
  billingEnforcement: "off" | "soft" | "hard";
  billingStatus: string | null;
  packageSku: string | null;
  packageName: string | null;
  version: number | null;
  versionId: string | null;
  minutesIncluded: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function packageVersionFromUnknown(raw: unknown): PackageVersionRow | null {
  if (!raw || typeof raw !== "object") return null;
  return versionFromJson(raw as Record<string, unknown>);
}

function versionFromJson(raw: Record<string, unknown>): PackageVersionRow {
  const features = Array.isArray(raw.features) ? raw.features : [];
  const status = raw.status === "draft" || raw.status === "retired" ? raw.status : "published";
  return {
    id: String(raw.id),
    version: num(raw.version),
    status,
    monthlyPriceKes: num(raw.monthly_price_kes),
    seats: num(raw.seats),
    minutes: num(raw.minutes),
    dids: num(raw.dids),
    messageCredits: numOrNull(raw.message_credits),
    smsCreditBurn: numOrNull(raw.sms_credit_burn),
    whatsappCreditBurn: numOrNull(raw.whatsapp_credit_burn),
    emailCreditBurn: numOrNull(raw.email_credit_burn),
    inboundKesPerSecond: num(raw.inbound_kes_per_second),
    outboundKesPerSecond: num(raw.outbound_kes_per_second),
    annualDiscountPercent: num(raw.annual_discount_percent),
    trialDays: numOrNull(raw.trial_days),
    onDemandAllowed: raw.on_demand_allowed === true,
    allowancesPlaceholder: raw.allowances_placeholder === true,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    subscriberCount: num(raw.subscriber_count),
    features: features.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.key !== "string") return [];
      return [{ key: row.key, label: typeof row.label === "string" ? row.label : row.key, enabled: row.enabled === true }];
    }),
  };
}

function catalogFromJson(raw: unknown): PackageVersionCatalog {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const featureRows = Array.isArray(body.features) ? body.features : [];
  const packageRows = Array.isArray(body.packages) ? body.packages : [];
  return {
    packageEditorEnabled: body.package_editor_enabled !== false,
    newSignupTrialEnabled: body.new_signup_trial_enabled === true,
    features: featureRows.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.key !== "string") return [];
      return [{ key: row.key, label: typeof row.label === "string" ? row.label : row.key }];
    }),
    packages: packageRows.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.sku !== "string" || typeof row.id !== "string") return [];
      const versions = Array.isArray(row.versions) ? row.versions : [];
      return [{
        id: row.id,
        sku: row.sku,
        name: typeof row.name === "string" ? row.name : row.sku,
        isActive: row.is_active !== false,
        versions: versions.flatMap((version) => {
          if (!version || typeof version !== "object") return [];
          return [versionFromJson(version as Record<string, unknown>)];
        }),
      }];
    }),
  };
}

export async function loadPackageVersionEditor(): Promise<{
  catalog: PackageVersionCatalog;
  businesses: BusinessPlanRow[];
}> {
  const admin = getSupabaseAdmin();
  const [catalogRes, tenantRes, subRes] = await Promise.all([
    admin.rpc("admin_list_package_versions"),
    admin.from("tenants").select("id, business_name, billing_enforcement, minutes_included").order("business_name"),
    admin.from("tenant_subscriptions").select("tenant_id, package_id, package_version_id, billing_status"),
  ]);
  if (catalogRes.error) throw catalogRes.error;
  if (tenantRes.error) throw tenantRes.error;
  if (subRes.error) throw subRes.error;

  const catalog = catalogFromJson(catalogRes.data);
  const versionById = new Map<string, { sku: string; name: string; version: number }>();
  for (const pack of catalog.packages) {
    for (const version of pack.versions) {
      versionById.set(version.id, { sku: pack.sku, name: pack.name, version: version.version });
    }
  }
  const subByTenant = new Map<string, { package_version_id: string | null; billing_status: string | null }>();
  for (const row of subRes.data || []) {
    subByTenant.set(row.tenant_id, row);
  }

  const businesses: BusinessPlanRow[] = (tenantRes.data || []).map((tenant) => {
    const sub = subByTenant.get(tenant.id);
    const pinned = sub?.package_version_id ? versionById.get(sub.package_version_id) : null;
    const enforcement = tenant.billing_enforcement === "soft" || tenant.billing_enforcement === "hard"
      ? tenant.billing_enforcement
      : "off";
    return {
      tenantId: tenant.id,
      businessName: tenant.business_name,
      billingEnforcement: enforcement,
      billingStatus: sub?.billing_status || null,
      packageSku: pinned?.sku || null,
      packageName: pinned?.name || null,
      version: pinned?.version ?? null,
      versionId: sub?.package_version_id || null,
      minutesIncluded: num(tenant.minutes_included),
    };
  });

  return { catalog, businesses };
}
