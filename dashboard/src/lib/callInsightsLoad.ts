import "server-only";
import { buildCallInsights, type CallFactRow, type CallInsights } from "@/lib/callInsights";

const COLS =
  "call_id, created_at, outcome, lost_reason, products_mentioned, price_objection, objection_price_ksh, unanswered_question, language, time_of_day, hour_eat, dow";

type Client = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Last 30 days of call_facts (RLS: members of the workspace). Null when the table is not there yet. */
export async function loadCallInsights(client: Client, tenantId: string, days = 30): Promise<CallInsights | null> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await client
    .from("call_facts")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("call insights unavailable", error.code || error.message);
    return null;
  }
  return buildCallInsights((data ?? []) as CallFactRow[], days);
}
