import type { BusinessPolicies } from "@/lib/businessPolicies";
import { POLICY_FIELDS } from "@/lib/businessPolicies";
import type { ProductItem } from "@/lib/productCatalog";
import { settingsScopeIncludes } from "@/lib/settingsSaveScope";
import { stableRowId } from "@/lib/factHash";

type ServiceRow = { name?: string; id?: string };
type FaqRow = { question?: string; answer?: string };

export type SettingsSaveAttestInput = {
  scope: string;
  businessName?: string;
  vertical?: string;
  spokenName?: string;
  agentName?: string;
  agentTone?: string | null;
  agentTools?: { escalate?: boolean; end_call?: boolean } | null;
  hasStructuredHours?: boolean;
  businessHoursLength?: number;
  businessLocationsCount?: number;
  businessPolicies?: BusinessPolicies;
  productCatalog?: ProductItem[];
  servicesCatalog?: ServiceRow[];
  faqs?: FaqRow[];
  hasSocialHandles?: boolean;
  lineNumber?: string;
};

function pushUnique(out: string[], seen: Set<string>, path: string) {
  if (!path || seen.has(path)) return;
  seen.add(path);
  out.push(path);
}

function catalogPaths(
  out: string[],
  seen: Set<string>,
  products: ProductItem[],
  services: ServiceRow[]
) {
  products.forEach((row, index) => {
    if (!String(row.name || "").trim()) return;
    const sku = String(row.sku || "").trim() || String(index + 1);
    pushUnique(out, seen, `catalog.product.${sku}.name`);
  });
  services.forEach((row, index) => {
    if (!String(row.name || "").trim()) return;
    pushUnique(out, seen, `catalog.service.${stableRowId(row) || String(index + 1)}.name`);
  });
}

function policyPaths(out: string[], seen: Set<string>, policies: BusinessPolicies) {
  for (const field of POLICY_FIELDS) {
    const text = String(policies[field.id] || "").trim();
    if (text) pushUnique(out, seen, `policies.${field.id}`);
  }
  if (String(policies.payment || "").trim() || String(policies.deposit || "").trim()) {
    pushUnique(out, seen, "payments.methods");
  }
  const coverage = policies.coverage_areas;
  if (Array.isArray(coverage) && coverage.length > 0) {
    pushUnique(out, seen, "policies.coverage_areas");
  }
}

function faqPaths(out: string[], seen: Set<string>, faqs: FaqRow[]) {
  faqs.forEach((row, index) => {
    if (!String(row.question || "").trim() || !String(row.answer || "").trim()) return;
    pushUnique(out, seen, `faqs.${index + 1}`);
  });
}

/** Paths to owner-attest after a successful scoped Settings save. */
export function fieldPathsAttestedOnSettingsSave(input: SettingsSaveAttestInput): string[] {
  const scope = String(input.scope || "").trim();
  const out: string[] = [];
  const seen = new Set<string>();

  const includes = (field: string) => settingsScopeIncludes(scope, field);

  if (includes("businessName") && String(input.businessName || "").trim()) {
    pushUnique(out, seen, "identity.business_name");
  }
  if (includes("vertical") && String(input.vertical || "").trim()) {
    pushUnique(out, seen, "identity.vertical");
  }
  if (includes("spokenName") && String(input.spokenName || "").trim()) {
    pushUnique(out, seen, "identity.spoken_name");
  }
  if (includes("agentName") && String(input.agentName || "").trim()) {
    pushUnique(out, seen, "assistant.agent_name");
  }
  if (includes("agentTone") && String(input.agentTone || "").trim()) {
    pushUnique(out, seen, "assistant.tone");
  }
  if (includes("socialHandles") && input.hasSocialHandles) {
    pushUnique(out, seen, "identity.social_handles");
  }
  if (includes("agentTools") && input.agentTools) {
    pushUnique(out, seen, "assistant.tools");
  }

  if (
    (includes("hoursSchedule") && input.hasStructuredHours) ||
    (includes("hoursSchedule") && (input.businessHoursLength ?? 0) >= 8)
  ) {
    pushUnique(out, seen, "hours.weekly_grid");
  }

  if (includes("businessLocations") && (input.businessLocationsCount ?? 0) > 0) {
    pushUnique(out, seen, "locations.branches");
  }

  if (includes("businessPolicies") && input.businessPolicies) {
    policyPaths(out, seen, input.businessPolicies);
  }

  if (includes("servicesCatalog") || includes("productCatalog")) {
    catalogPaths(out, seen, input.productCatalog || [], input.servicesCatalog || []);
  }

  if (includes("faqs") && input.faqs) {
    faqPaths(out, seen, input.faqs);
  }

  if (String(input.lineNumber || "").trim()) {
    pushUnique(out, seen, "identity.primary_phone");
  }

  return out;
}

export function fieldPathsAttestedOnAlertsSave(input: {
  whatsappNumber?: string | null;
  alertEmail?: string | null;
  hasNotifyChannels?: boolean;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (String(input.whatsappNumber || "").trim()) {
    pushUnique(out, seen, "team.notify.whatsapp");
  }
  if (String(input.alertEmail || "").trim()) {
    pushUnique(out, seen, "team.notify.email");
  }
  if (input.hasNotifyChannels) {
    pushUnique(out, seen, "team.notify.channels");
  }
  return out;
}

export function fieldPathsAttestedOnBulletinSave(hasBulletinItems: boolean): string[] {
  return hasBulletinItems ? ["bulletin.items"] : [];
}
