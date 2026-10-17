import { requireSuperAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { QUIET_DAYS, todayWindows, type CallCount, type CallCounts, type TimeWindow } from "@/lib/adminTodayModel";

/** A missing `calls.resolution` column (older databases) reads as a gap, not as zero. */
function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "42703" || e?.code === "PGRST204" || /resolution/i.test(String(e?.message || ""));
}

/**
 * Today's call counts against the same stretch last week. Reads only. No inserts, updates, or mail.
 */
export async function loadTodayCallCounts(now: Date = new Date()): Promise<CallCounts> {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const windows = todayWindows(now);

  async function count(window: TimeWindow, resolution?: string): Promise<number> {
    let query = admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", window.start)
      .lt("created_at", window.end);
    if (resolution) query = query.eq("resolution", resolution);
    const { count: n, error } = await query;
    if (error) throw error;
    return n || 0;
  }

  async function pair(resolution?: string): Promise<CallCount> {
    try {
      const [today, lastWeek] = await Promise.all([count(windows.today, resolution), count(windows.lastWeek, resolution)]);
      return { today, lastWeek };
    } catch (err) {
      if (resolution && isMissingColumn(err)) return null;
      throw err;
    }
  }

  const [total, needsHuman, abandoned] = await Promise.all([pair(), pair("needs_human"), pair("abandoned")]);
  return { total, needsHuman, abandoned };
}

/**
 * Which of these businesses took at least one call in the last 7 days. One head count each,
 * so a busy week can't hit the row cap and wrongly mark a business quiet. Null on a failed read.
 */
export async function businessesWithRecentCalls(ids: string[], now: Date = new Date()): Promise<Set<string> | null> {
  await requireSuperAdmin();
  if (!ids.length) return new Set();
  const admin = getSupabaseAdmin();
  const since = new Date(now.getTime() - QUIET_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const counted = await Promise.all(
      ids.map(async (id) => {
        const { count, error } = await admin
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", id)
          .gte("created_at", since);
        if (error) throw error;
        return [id, count || 0] as const;
      }),
    );
    return new Set(counted.filter(([, n]) => n > 0).map(([id]) => id));
  } catch (err) {
    console.error("[admin:today] recent calls", err instanceof Error ? err.message : err);
    return null;
  }
}
