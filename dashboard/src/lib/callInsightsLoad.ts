import "server-only";
import { buildCallInsights, type CallFactRow, type CallInsights } from "@/lib/callInsights";

const COLS =
  "call_id, created_at, outcome, lost_reason, products_mentioned, price_objection, objection_price_ksh, unanswered_question, language, time_of_day, hour_eat, dow, source, calls!inner(duration_seconds)";

/** FAQ questions already on file, so answered rows show as done. */
function faqQuestions(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((f) => String((f as { question?: unknown } | null)?.question ?? "").trim())
    .filter(Boolean);
}

type Client = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Last 30 days of call_facts (RLS: members of the workspace). Null when the table is not there yet. */
export async function loadCallInsights(client: Client, tenantId: string, days = 30, faqs: unknown = []): Promise<CallInsights | null> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await client
    .from("call_facts")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    // Only calls the Business Assistant read (or the owner fixed); no smoke tests or dead lines.
    .in("source", ["review", "owner"])
    .gt("calls.duration_seconds", 0)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("call insights unavailable", error.code || error.message);
    return null;
  }
  const rows = ((data ?? []) as Array<CallFactRow & { calls?: { duration_seconds?: number | null } | null }>).map(
    ({ calls, ...r }) => ({ ...r, duration_seconds: calls?.duration_seconds ?? null }),
  );
  return buildCallInsights(rows, days, { faqQuestions: faqQuestions(faqs) });
}
