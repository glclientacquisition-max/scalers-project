import { getSupabaseAdmin } from "@/lib/supabase";
import {
  callEligibleForRetentionPurge,
  envRetentionDays,
  parseRetentionStored,
  resolveEffectiveRetentionDays,
  type EffectiveRetention,
} from "@/lib/recordingRetentionPolicy";

export type RecordingRetentionContext = {
  platformDays: number | null;
  overrides: Map<string, number>;
  envDays: number;
};

export async function loadRecordingRetentionContext(): Promise<RecordingRetentionContext> {
  const admin = getSupabaseAdmin();
  let platformDays: number | null = null;
  try {
    const { data, error } = await admin
      .from("platform_ops_settings")
      .select("recording_retention_days")
      .eq("id", 1)
      .maybeSingle();
    if (error && !/recording_retention_days|schema cache/i.test(error.message)) throw error;
    if (!error && data?.recording_retention_days != null) {
      platformDays = parseRetentionStored(data.recording_retention_days);
    }
  } catch (err) {
    if (!/recording_retention_days|schema cache/i.test((err as Error)?.message || "")) throw err;
  }

  const overrides = new Map<string, number>();
  try {
    const { data, error } = await admin.from("tenants").select("id, recording_retention_days_override");
    if (error && !/recording_retention_days_override|schema cache/i.test(error.message)) throw error;
    for (const row of data || []) {
      if (row?.id != null && row.recording_retention_days_override != null) {
        const parsed = parseRetentionStored(row.recording_retention_days_override);
        if (parsed != null) overrides.set(String(row.id), parsed);
      }
    }
  } catch (err) {
    if (!/recording_retention_days_override|schema cache/i.test((err as Error)?.message || ""))
      throw err;
  }

  return { platformDays, overrides, envDays: envRetentionDays() };
}

export function effectiveRetentionForTenant(
  context: RecordingRetentionContext,
  tenantId: string,
  proposedPlatformDays?: number | null,
): EffectiveRetention {
  const platformDays =
    proposedPlatformDays !== undefined ? proposedPlatformDays : context.platformDays;
  return resolveEffectiveRetentionDays({
    tenantOverride: context.overrides.get(tenantId),
    platformDays,
    envDays: context.envDays,
  });
}

/** Rough count of recordings the next purge run would delete. */
export async function countRecordingPurgeAtNextRun(
  proposedPlatformDays?: number | null,
  maxScan = 5000,
): Promise<{ count: number; capped: boolean }> {
  const context = await loadRecordingRetentionContext();
  const admin = getSupabaseAdmin();
  const minDays = 7;
  const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("calls")
    .select("tenant_id, created_at, recording_url, summary")
    .lt("created_at", cutoff)
    .or("recording_url.not.is.null,summary.like.%recording_path%")
    .order("created_at", { ascending: true })
    .limit(maxScan);
  if (error) throw error;

  let count = 0;
  for (const row of data || []) {
    const summary = row.summary;
    let meta: Record<string, unknown> = {};
    if (typeof summary === "string" && summary.trim().startsWith("{")) {
      try {
        meta = JSON.parse(summary) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    } else if (summary && typeof summary === "object") {
      meta = summary as Record<string, unknown>;
    }
    if (meta.recording_deleted_at) continue;
    if (!row.recording_url && !meta.recording_path) continue;
    const tenantId = String(row.tenant_id || "");
    const effective = effectiveRetentionForTenant(context, tenantId, proposedPlatformDays);
    if (callEligibleForRetentionPurge(row.created_at, effective)) count += 1;
  }
  return { count, capped: (data || []).length >= maxScan };
}

export async function saveTenantRecordingRetentionOverride(
  tenantId: string,
  raw: unknown,
): Promise<number | null> {
  const value = raw === "" || raw === undefined ? null : parseRetentionStored(raw);
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({ recording_retention_days_override: value })
    .eq("id", tenantId);
  if (error && /recording_retention_days_override/i.test(error.message)) {
    return null;
  }
  if (error) throw error;
  return value;
}
