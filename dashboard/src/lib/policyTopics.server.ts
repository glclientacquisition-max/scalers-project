import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyTopicPatch, type TopicPatch } from "@/lib/policyRegistry";

/**
 * Write one topic. Prefers the set_policy_topic RPC (docs/supabase/policy_topics.sql), a
 * single UPDATE that only touches this topic's paths. Until that SQL is applied it falls back
 * to: read business_policies fresh, patch only this topic, write back if nobody changed it
 * in between (compare-and-set on the jsonb we read).
 */
export async function savePolicyTopic(client: SupabaseClient, tenantId: string, patch: TopicPatch): Promise<{ ok: true; via: "rpc" | "cas" } | { ok: false; error: string }> {
  const rpc = await client.rpc("set_policy_topic", {
    p_tenant_id: tenantId,
    p_topic: patch.topic,
    p_rule: patch.rule,
    p_line: patch.line,
    p_text_key: patch.textKey,
    p_text: patch.text,
  });
  if (!rpc.error) return { ok: true, via: "rpc" };
  // PGRST202: function not found (SQL not applied yet). Anything else is a real failure.
  if (rpc.error.code !== "PGRST202" && !/set_policy_topic/.test(rpc.error.message ?? "")) return { ok: false, error: rpc.error.message };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await client.from("tenants").select("business_policies").eq("id", tenantId).maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "tenant not found" };
    const before = (data.business_policies as Record<string, unknown> | null) ?? {};
    const next = applyTopicPatch(before, patch);
    const upd = await client
      .from("tenants")
      .update({ business_policies: next })
      .eq("id", tenantId)
      .eq("business_policies", JSON.stringify(before))
      .select("id");
    if (upd.error) return { ok: false, error: upd.error.message };
    if ((upd.data ?? []).length === 1) return { ok: true, via: "cas" };
  }
  return { ok: false, error: "changed while saving" };
}
