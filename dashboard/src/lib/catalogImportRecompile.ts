import "server-only";

/**
 * GIGO P0 Platform hook (roadmap §9 #5): retail catalog import must refresh
 * llm_system_prompt after the owner confirms the diff.
 *
 * Desk should call this from the import confirm path (not from preview-only saves).
 */
import { parseAgentTools } from "@/lib/agentTools";
import {
  formatLocationsForCompiler,
  normalizeBusinessLocations,
} from "@/lib/businessLocations";
import { formatPoliciesForCompiler, normalizeBusinessPolicies } from "@/lib/businessPolicies";
import { formatHoursForCompiler, scheduleForForm } from "@/lib/hoursSchedule";
import { parseAgentTone, compileReceptionistPrompt } from "@/lib/promptCompiler";
import {
  formatProductsForCompiler,
  normalizeProductCatalog,
} from "@/lib/productCatalog";
import {
  formatServicesForCompiler,
  normalizeServicesCatalog,
} from "@/lib/servicesCatalog";
import {
  formatSocialHandlesForCompiler,
  normalizeSocialHandles,
} from "@/lib/socialHandles";
import type { FaqEntry, TenantRow } from "@/lib/supabase";
import { clampFaq } from "@/lib/faqs";
import { normalizeTeamDirectory } from "@/lib/teamNotify";
import { loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AGENT_TONE } from "@/lib/onboarding";

function normalizeFaqs(raw: unknown): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const entry = clampFaq(row as FaqEntry);
      return entry.question && entry.answer ? entry : null;
    })
    .filter((f): f is FaqEntry => Boolean(f));
}

export async function recompileAfterCatalogImport(opts: {
  client: SupabaseClient;
  tenant: TenantRow;
  productCatalog?: unknown;
}): Promise<{ ok: boolean; error?: string; source?: "gemini" | "local" }> {
  const { client, tenant } = opts;
  const productCatalog = normalizeProductCatalog(
    opts.productCatalog ?? tenant.product_catalog
  );
  const services = normalizeServicesCatalog(tenant.services_catalog).filter((s) => s.name);
  const servicesOffered =
    formatServicesForCompiler(services, "") ||
    String(tenant.services_offered || "").trim();
  const schedule = scheduleForForm(tenant.hours_schedule, tenant.business_hours || "");
  const businessHours =
    formatHoursForCompiler(schedule) || String(tenant.business_hours || "").trim();
  const agentTone = parseAgentTone(String(tenant.agent_tone || "")) ?? DEFAULT_AGENT_TONE;
  const agentTools = parseAgentTools(tenant.agent_tools);
  const policies = normalizeBusinessPolicies(tenant.business_policies);
  const locationsText = formatLocationsForCompiler(
    normalizeBusinessLocations(tenant.business_locations)
  );
  const policiesText = formatPoliciesForCompiler(policies);
  const productsBlock = formatProductsForCompiler(productCatalog);
  const socialBlock = formatSocialHandlesForCompiler(
    normalizeSocialHandles(tenant.social_handles)
  );
  const provenance = await loadCompileProvenance(tenant.id);

  const { prompt, source } = await compileReceptionistPrompt({
    businessName: tenant.business_name,
    servicesOffered,
    businessHours,
    agentTone,
    agentName: String(tenant.agent_name || "Receptionist").trim() || "Receptionist",
    teamDirectory: normalizeTeamDirectory(tenant.team_directory),
    faqs: normalizeFaqs(tenant.faqs),
    unknownAnswerFallback: String(tenant.unknown_answer_fallback || "").trim(),
    escalateEnabled: agentTools.escalate,
    vertical: String(tenant.vertical || "general"),
    handoffMode: String(tenant.handoff_mode || "callback"),
    locationsText,
    policiesText,
    productsText: productsBlock,
    socialText: socialBlock,
    productCatalog,
    businessPolicies: policies,
    fieldMeta: provenance.fieldMeta,
    holdGate: provenance.holdGate,
  });

  const { error } = await client
    .from("tenants")
    .update({ llm_system_prompt: prompt })
    .eq("id", tenant.id);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, source };
}
