import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import type { FactRow } from "@/lib/ops/insightsView";

const PAGE = 1000;
const MAX_ROWS = 50_000;

/**
 * Counts-only call facts for the last `days` days across all businesses (ADMIN_V2). Reads only.
 * Selects tenant, intent, outcome, time and whether a question went unanswered; the question text,
 * caller number and transcript never leave this function. Same filter as the owner insights load:
 * reviewed or owner-corrected facts on connected calls. null when the read failed.
 */
export async function loadInsightFacts(days: number, tenantId?: string | null): Promise<FactRow[] | null> {
  try {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const rows: FactRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      let q = getSupabaseAdmin()
        .from("call_facts")
        .select("tenant_id, intent, outcome, unanswered_question, created_at, calls!inner(duration_seconds)")
        .in("source", ["review", "owner"])
        .gt("calls.duration_seconds", 0)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) return null;
      for (const r of data || []) {
        rows.push({
          tenantId: String(r.tenant_id),
          intent: r.intent ? String(r.intent) : null,
          outcome: r.outcome ? String(r.outcome) : null,
          unanswered: typeof r.unanswered_question === "string" && r.unanswered_question.trim().length > 0,
          createdAt: String(r.created_at),
        });
      }
      if (!data || data.length < PAGE) break;
    }
    return rows;
  } catch {
    return null;
  }
}

/** Business names for the insights table. Reads only. */
export async function loadBusinessNames(): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseAdmin().from("tenants").select("id, business_name");
  if (error) throw error;
  return new Map((data || []).map((t) => [String(t.id), String(t.business_name || "Business")]));
}
