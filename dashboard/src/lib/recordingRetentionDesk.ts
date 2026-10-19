import {
  effectiveRetentionForTenant,
  loadRecordingRetentionContext,
  type RecordingRetentionContext,
} from "@/lib/recordingRetentionAdmin";
import type { EffectiveRetention } from "@/lib/recordingRetentionPolicy";

let cached: RecordingRetentionContext | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function contextFresh(): Promise<RecordingRetentionContext> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;
  cached = await loadRecordingRetentionContext();
  cachedAt = now;
  return cached;
}

export async function effectiveRecordingRetentionForTenant(
  tenantId: string,
): Promise<EffectiveRetention> {
  const ctx = await contextFresh();
  return effectiveRetentionForTenant(ctx, tenantId);
}
