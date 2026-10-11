import "server-only";
import { createWorkspaceDataClient } from "@/lib/tenant";

/** business_type/business_category (new columns). Null when not readable yet (pre-migration). */
export async function readBusinessType(tenantId: string): Promise<{ business_type: string | null; business_category: string | null } | null> {
  const ws = await createWorkspaceDataClient();
  if (!ws) return null;
  const { data, error } = await ws.client.from("tenants").select("business_type, business_category").eq("id", tenantId).maybeSingle();
  if (error || !data) return null;
  return data as { business_type: string | null; business_category: string | null };
}

export type CallFactsRow = {
  intent: string | null;
  outcome: string | null;
  lost_reason: string | null;
  source: "review" | "legacy" | "owner" | null;
};

export async function readCallFacts(callId: string): Promise<CallFactsRow | null> {
  const ws = await createWorkspaceDataClient();
  if (!ws) return null;
  const { data, error } = await ws.client.from("call_facts").select("intent, outcome, lost_reason, source").eq("call_id", callId).maybeSingle();
  if (error) return null;
  return (data as CallFactsRow) || { intent: null, outcome: null, lost_reason: null, source: null };
}
