import { getSupabaseAdmin } from "@/lib/supabase";
import {
  emptyBusiness,
  emptyCall,
  emptyHome,
  emptyReleases,
  getBusinessQuality as shapeBusinessQuality,
  getCallTrace as shapeCallTrace,
  interpretTraceQuery,
  isMissingScoreColumn,
  listBusinessQuality as shapeBusinessList,
  listReleaseDeltasFromRows,
} from "@/lib/quality/assemble";
const MAX_ROWS = 2000;
const TRACE_COLUMNS =
  "call_id,tenant_id,turn_index,record_kind,pii,payload,score,checks,diagnosis,release,created_at";
const TRACE_COLUMNS_BASE = "call_id,tenant_id,turn_index,record_kind,pii,payload,created_at";

type TraceRow = {
  call_id: string;
  tenant_id: string | null;
  turn_index: number | null;
  record_kind: string;
  pii: string | null;
  payload: Record<string, unknown> | null;
  score?: number | string | null;
  checks?: Record<string, number> | null;
  diagnosis?: string | null;
  release?: { gitSha?: string | null; branch?: string | null; label?: string | null } | null;
  created_at: string;
};

type TraceQuery = {
  data: TraceRow[] | null;
  error: { message?: string; code?: string } | null;
};

function lookbackDays(windowDays: number): number {
  return Math.max(windowDays, 7) * 2;
}

function sinceIso(now: number, days: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

async function selectTraces(build: (columns: string) => PromiseLike<unknown>): Promise<TraceQuery> {
  const full = (await build(TRACE_COLUMNS)) as TraceQuery;
  if (full.error && isMissingScoreColumn(full.error)) {
    return (await build(TRACE_COLUMNS_BASE)) as TraceQuery;
  }
  return full;
}

async function loadBusinessNames(
  admin: ReturnType<typeof getSupabaseAdmin>,
  ids: string[],
): Promise<Record<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await admin.from("tenants").select("id, business_name").in("id", unique);
  if (error || !data) return {};
  const names: Record<string, string | null> = {};
  for (const row of data as Array<{ id: string; business_name: string | null }>) {
    names[String(row.id)] = row.business_name || null;
  }
  return names;
}

async function lookupBusiness(
  admin: ReturnType<typeof getSupabaseAdmin>,
  businessId: string,
): Promise<{ found: boolean; name: string | null }> {
  const { data, error } = await admin
    .from("tenants")
    .select("id, business_name")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) return { found: false, name: null };
  const row = data as { id: string; business_name: string | null };
  return { found: true, name: row.business_name || null };
}

export async function listBusinessQuality(opts: { windowDays: number; now?: number }) {
  const now = opts.now ?? Date.now();
  const admin = getSupabaseAdmin();
  const since = sinceIso(now, lookbackDays(opts.windowDays));
  const query = await selectTraces((columns) =>
    admin
      .from("voice_turn_traces")
      .select(columns)
      .eq("record_kind", "call")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
  );
  const interpreted = interpretTraceQuery(query);
  if (!interpreted.ready) return emptyHome(opts.windowDays);
  const rows = interpreted.rows as TraceRow[];
  const names = await loadBusinessNames(
    admin,
    rows.map((row) => String(row.tenant_id || "")),
  );
  return shapeBusinessList({
    rows,
    names,
    now,
    windowDays: opts.windowDays,
    truncated: rows.length >= MAX_ROWS,
  });
}

export async function getBusinessQuality(opts: { businessId: string; limit: number; now?: number }) {
  const now = opts.now ?? Date.now();
  const admin = getSupabaseAdmin();
  const since = sinceIso(now, 14);
  const [query, business] = await Promise.all([
    selectTraces((columns) =>
      admin
        .from("voice_turn_traces")
        .select(columns)
        .eq("record_kind", "call")
        .eq("tenant_id", opts.businessId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
    ),
    lookupBusiness(admin, opts.businessId),
  ]);
  const interpreted = interpretTraceQuery(query);
  if (!interpreted.ready) return emptyBusiness(opts.businessId);
  const rows = interpreted.rows as TraceRow[];
  if (!business.found && rows.length === 0) return null;
  return shapeBusinessQuality({
    rows,
    businessId: opts.businessId,
    businessName: business.name,
    limit: opts.limit,
    now,
  });
}

export async function getCallTrace(callId: string) {
  const admin = getSupabaseAdmin();
  const query = await selectTraces((columns) =>
    admin
      .from("voice_turn_traces")
      .select(columns)
      .eq("call_id", callId)
      .order("turn_index", { ascending: true })
      .limit(MAX_ROWS),
  );
  const interpreted = interpretTraceQuery(query);
  if (!interpreted.ready) return emptyCall();
  return shapeCallTrace({ rows: interpreted.rows as TraceRow[] });
}

export async function listReleaseDeltas(opts: {
  windowDays: number;
  businessId?: string | null;
  now?: number;
}) {
  const now = opts.now ?? Date.now();
  const admin = getSupabaseAdmin();
  const since = sinceIso(now, lookbackDays(opts.windowDays));
  const businessId = opts.businessId || "";
  const query = await selectTraces((columns) => {
    const next = admin
      .from("voice_turn_traces")
      .select(columns)
      .eq("record_kind", "call")
      .gte("created_at", since);
    const scoped = businessId ? next.eq("tenant_id", businessId) : next;
    return scoped.order("created_at", { ascending: false }).limit(MAX_ROWS);
  });
  const interpreted = interpretTraceQuery(query);
  if (!interpreted.ready) return emptyReleases(opts.windowDays);
  const rows = interpreted.rows as TraceRow[];
  return {
    ok: true,
    ready: true,
    windowDays: opts.windowDays,
    businessId: opts.businessId || null,
    truncated: rows.length >= MAX_ROWS,
    release: emptyReleases(opts.windowDays).release,
    releases: listReleaseDeltasFromRows({
      rows,
      businessId: opts.businessId || null,
    }),
  };
}
