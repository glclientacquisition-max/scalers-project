import "server-only";

/**
 * Desk adapter for tenant field provenance.
 *
 * TODO: once https://github.com/glclientacquisition-max/scalers-project/pull/570
 * merges, re-export getTenantCompletenessScore, getTenantHoldGate,
 * upsertTenantFieldMeta, and confirmTenantField from ./tenantFieldProvenance,
 * and recompileAfterCatalogImport from ./catalogImportRecompile.
 * Do not add those files on this branch.
 *
 * Live RPC reads depend on #570. Staging already exposes the four RPCs;
 * this module calls them and falls back to the local stub when a call
 * is missing (owner 100, import and seed 0). Brain #572 also wants
 * `dashboard/src/lib/provenance.ts` as a compile twin. Keep this adapter
 * here until that file can be split.
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AGENT_TONE } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant";
import {
  holdCaptureTenant,
  scoreCaptureTenant,
  type ScoreTenant,
} from "@/lib/completenessStub";

export type TenantCompletenessScore = {
  overall: number;
  domains: Record<string, number>;
  ready_badge: boolean;
  next_gaps: Array<{ domain?: string; action?: string }>;
};

export type TenantHoldGate = {
  allowed: boolean;
  reasons: string[];
};

const MISSING_RPC =
  /PGRST202|42883|does not exist|Could not find the function|schema cache/i;

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return MISSING_RPC.test(`${error.code || ""} ${error.message || ""}`);
}

function parseHoldGate(raw: unknown): TenantHoldGate {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reasonsRaw = row.reasons;
  const reasons = Array.isArray(reasonsRaw) ? reasonsRaw.map((item) => String(item)) : [];
  return {
    allowed: row.allowed === true,
    reasons,
  };
}

function parseCompleteness(raw: unknown): TenantCompletenessScore | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const domains =
    row.domains && typeof row.domains === "object"
      ? (row.domains as Record<string, number>)
      : {};
  const gaps = Array.isArray(row.next_gaps) ? row.next_gaps : [];
  return {
    overall: Number(row.overall ?? 0),
    domains,
    ready_badge: row.ready_badge === true,
    next_gaps: gaps as TenantCompletenessScore["next_gaps"],
  };
}

async function loadScoreTenant(tenantId: string): Promise<ScoreTenant | null> {
  const current = await getCurrentTenant();
  if (current && current.id === tenantId) return current;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return data as ScoreTenant;
  } catch {
    return null;
  }
}

export async function getTenantCompletenessScore(
  tenantId: string
): Promise<TenantCompletenessScore | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("tenant_completeness_score", {
      p_tenant_id: tenantId,
    });
    if (!error) {
      const parsed = parseCompleteness(data);
      if (parsed) return parsed;
    } else if (!isMissingRpc(error)) {
      console.warn("[provenance] tenant_completeness_score", error.message);
    }
  } catch (err) {
    console.warn("[provenance] tenant_completeness_score", err);
  }
  const tenant = await loadScoreTenant(tenantId);
  if (!tenant) return null;
  return scoreCaptureTenant(tenant);
}

export async function getTenantHoldGate(tenantId: string): Promise<TenantHoldGate | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("tenant_hold_gate", {
      p_tenant_id: tenantId,
    });
    if (!error) return parseHoldGate(data);
    if (!isMissingRpc(error)) {
      console.warn("[provenance] tenant_hold_gate", error.message);
    }
  } catch (err) {
    console.warn("[provenance] tenant_hold_gate", err);
  }
  const tenant = await loadScoreTenant(tenantId);
  if (!tenant) return null;
  return holdCaptureTenant(tenant);
}

export async function upsertTenantFieldMeta(input: {
  tenantId: string;
  fieldPath: string;
  source: "owner" | "seed" | "import" | "inferred" | "call_suggested";
  sourceRef?: string | null;
  confidence?: number | null;
  staleAfterDays?: number | null;
  actor?: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc("upsert_tenant_field_meta", {
    p_tenant_id: input.tenantId,
    p_field_path: input.fieldPath,
    p_source: input.source,
    p_source_ref: input.sourceRef ?? null,
    p_confidence: input.confidence ?? null,
    p_stale_after_days: input.staleAfterDays ?? null,
    p_actor: input.actor ?? "desk",
    p_old_value: input.oldValue ?? null,
    p_new_value: input.newValue ?? null,
  });
}

const POLICY_PATH = /^policies\.(payment|deposit|returns|delivery|cancellation|warranty|other)$/;

/** Writes owner on the JSON row so Brain can read the confirm before it reads meta. */
export async function persistOwnerConfirm(
  client: SupabaseClient,
  tenantId: string,
  fieldPath: string
): Promise<boolean> {
  const product = fieldPath.match(/^catalog\.product\.(.+)\.name$/);
  const service = fieldPath.match(/^catalog\.service\.(\d+)\.name$/);
  const faq = fieldPath.match(/^faqs\.(\d+)/);
  const policy = fieldPath.match(POLICY_PATH);
  if (!product && !service && !faq && !policy) return false;

  const { data, error } = await client
    .from("tenants")
    .select("product_catalog, services_catalog, faqs, business_policies")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return false;

  const patch: Record<string, unknown> = {};
  if (product) {
    const key = product[1];
    const rows = Array.isArray(data.product_catalog) ? data.product_catalog : [];
    let hit = false;
    patch.product_catalog = rows.map((row: Record<string, unknown>, index: number) => {
      const sku = String(row?.sku || "").trim() || String(index + 1);
      if (sku !== key && String(index + 1) !== key) return row;
      hit = true;
      return { ...row, source: "owner" };
    });
    if (!hit) return false;
  } else if (service) {
    const index = Number(service[1]) - 1;
    const rows = Array.isArray(data.services_catalog) ? [...data.services_catalog] : [];
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    rows[index] = { ...(row as Record<string, unknown>), source: "owner" };
    patch.services_catalog = rows;
  } else if (faq) {
    const index = Number(faq[1]) - 1;
    const rows = Array.isArray(data.faqs) ? [...data.faqs] : [];
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    const prevStatus = String((row as Record<string, unknown>).status || "").toLowerCase();
    rows[index] = {
      ...(row as Record<string, unknown>),
      source: "owner",
      status: prevStatus === "golden" ? "golden" : "confirmed",
      confirmed: true,
    };
    patch.faqs = rows;
  } else if (policy) {
    const key = policy[1];
    const current =
      data.business_policies &&
      typeof data.business_policies === "object" &&
      !Array.isArray(data.business_policies)
        ? (data.business_policies as Record<string, unknown>)
        : {};
    const prev =
      current.provenance && typeof current.provenance === "object" && !Array.isArray(current.provenance)
        ? (current.provenance as Record<string, unknown>)
        : {};
    patch.business_policies = {
      ...current,
      provenance: {
        ...prev,
        [key]: { source: "owner", confirmed: true },
      },
    };
  }

  const updated = await client.from("tenants").update(patch).eq("id", tenantId);
  return !updated.error;
}

export async function confirmTenantField(input: {
  tenantId: string;
  fieldPath: string;
  userId?: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("confirm_tenant_field", {
    p_tenant_id: input.tenantId,
    p_field_path: input.fieldPath,
    p_user_id: input.userId ?? null,
  });
  if (!result.error || !isMissingRpc(result.error)) return result;
  const patched = await persistOwnerConfirm(supabase, input.tenantId, input.fieldPath);
  if (!patched) return result;
  return {
    data: { field_path: input.fieldPath, source: "owner" },
    error: null,
  };
}

function normalizeFaqs(raw: unknown): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const entry = clampFaq({
        question: String(record.question || ""),
        answer: String(record.answer || ""),
      });
      return entry.question && entry.answer ? entry : null;
    })
    .filter((faq): faq is FaqEntry => Boolean(faq));
}

/**
 * Same signature as #570 `recompileAfterCatalogImport`.
 * TODO: replace this body with a re-export from ./catalogImportRecompile after that PR merges.
 */
export async function recompileAfterCatalogImport(opts: {
  client: SupabaseClient;
  tenant: TenantRow;
  productCatalog?: unknown;
}): Promise<{ ok: boolean; error?: string; source?: "gemini" | "local" }> {
  const { client, tenant } = opts;
  const productCatalog = normalizeProductCatalog(
    opts.productCatalog ?? tenant.product_catalog
  );
  const services = normalizeServicesCatalog(tenant.services_catalog).filter((service) => service.name);
  const servicesOffered =
    formatServicesForCompiler(services, "") || String(tenant.services_offered || "").trim();
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
