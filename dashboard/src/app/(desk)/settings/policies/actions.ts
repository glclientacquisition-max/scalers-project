"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";
import { bustTenantCache } from "@/lib/tenantCache";
import { TOPICS, draftErrors, nicheFor, ruleFromDraft, topicPatch, type Draft } from "@/lib/policyRegistry";
import { normalizeRules } from "@/lib/policyRules";
import { savePolicyTopic } from "@/lib/policyTopics.server";

export type PolicySaveResult = { ok: true } | { ok: false; error: string };

/** Save one topic. Only rules.<topic>, policy_lines.<topic> and its text key change. */
export async function savePolicyTopicAction(topicId: string, draft: Draft): Promise<PolicySaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const topic = TOPICS[topicId];
  if (!topic) return { ok: false, error: "That topic isn't on this page." };
  const errs = draftErrors(draft);
  if (errs.length) return { ok: false, error: errs.map((e) => e.summary).join(". ") };
  const rule = ruleFromDraft(topic, draft);
  // Same cleaning as every other save path (caps, unknown fields dropped).
  const clean = rule ? ((normalizeRules({ [topicId]: rule }) as Record<string, Record<string, unknown>>)[topicId] ?? null) : null;
  const stored = (tenant.business_policies as Record<string, unknown> | null) ?? {};
  const niche = nicheFor(tenant as { vertical?: string | null; business_name?: string | null });
  const res = await savePolicyTopic(getSupabaseAdmin(), tenant.id, topicPatch(stored, topicId, clean, niche));
  bustTenantCache(tenant.id);
  if (!res.ok) return { ok: false, error: "Couldn't save. Nothing was changed. Try again." };
  revalidatePath("/settings/policies");
  return { ok: true };
}
