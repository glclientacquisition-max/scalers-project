'use strict';

/**
 * Daily purge of call recordings past effective retention (platform, tenant, env).
 * Uses the same hourly EAT tick as snapshot_data_quality (no pg_cron).
 */

const { eatDay, eatHour } = require('./dataQualityDaily');
const {
  callEligibleForRetentionPurge,
  envRetentionDays,
} = require('./recordingRetentionPolicy');
const {
  loadRecordingRetentionContext,
  effectiveRetentionForTenant,
  RETENTION_MIN_DAYS,
} = require('./recordingRetentionSettings');
const { minActiveRetentionDays } = require('./recordingRetentionPolicy');

function retentionDays() {
  const n = Number(process.env.RECORDING_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

/**
 * @param {{
 *   listCalls?: typeof import('../db').listCallsForRecordingRetentionPurge,
 *   purgeCall?: typeof import('../db').purgeCallRecordingRetention,
 *   deleteProvider?: (callSid: string) => Promise<{ ok?: boolean }>,
 *   loadContext?: typeof loadRecordingRetentionContext,
 *   retentionContext?: Awaited<ReturnType<typeof loadRecordingRetentionContext>>,
 *   batchSize?: number,
 *   log?: Console,
 *   supabase?: import('@supabase/supabase-js').SupabaseClient,
 * }} deps
 */
async function purgeExpiredRecordingsBatch(deps = {}) {
  const log = deps.log || console;
  const limit = deps.batchSize ?? 50;
  const listCalls = deps.listCalls;
  const purgeCall = deps.purgeCall;
  const deleteProvider = deps.deleteProvider;
  if (!listCalls || !purgeCall) {
    throw new Error('[recording-retention] listCalls and purgeCall required');
  }

  const context =
    deps.retentionContext ||
    (deps.loadContext
      ? await deps.loadContext(deps.supabase)
      : await loadRecordingRetentionContext(require('../lib/supabaseClient').supabase));

  const minDays = minActiveRetentionDays({
    platformDays: context.platformDays,
    overrides: context.overrides,
    envDays: context.envDays,
  });
  if (minDays === null) {
    return { candidates: 0, purged: 0, skipped: 0, retentionDisabled: true };
  }

  const rows = await listCalls({ minOlderThanDays: minDays, limit: limit * 4 });
  const eligible = rows.filter((row) => {
    const effective = effectiveRetentionForTenant(context, row.tenant_id);
    return callEligibleForRetentionPurge(row.created_at, effective);
  }).slice(0, limit);

  let purged = 0;
  let skipped = 0;
  for (const row of eligible) {
    const callSid = row.sautikit_call_sid;
    if (!callSid) {
      skipped += 1;
      continue;
    }
    if (deleteProvider) {
      try {
        await deleteProvider(callSid);
      } catch (err) {
        log.warn?.(
          `[recording-retention] provider delete failed ${callSid}:`,
          err?.message || err
        );
      }
    }
    const result = await purgeCall({
      callSid,
      tenantId: row.tenant_id,
    });
    if (result.purged) purged += 1;
    else skipped += 1;
  }
  if (purged || eligible.length) {
    log.info?.(
      `[recording-retention] batch minDays=${minDays} eligible=${eligible.length} purged=${purged} skipped=${skipped}`
    );
  }
  return { candidates: eligible.length, purged, skipped };
}

function startRecordingRetentionDaily({
  purgeBatch,
  hour = 4,
  intervalMs = 60 * 60 * 1000,
  log = console,
} = {}) {
  const flag = String(process.env.RECORDING_RETENTION_PURGE || 'on').toLowerCase();
  if (['off', '0', 'false', 'no'].includes(flag)) return null;
  if (process.env.NODE_ENV === 'test') return null;
  if (!purgeBatch) return null;

  let lastDay = null;
  const tick = async (now = new Date()) => {
    const day = eatDay(now);
    if (day === lastDay || eatHour(now) < hour) return false;
    lastDay = day;
    try {
      await purgeBatch();
      return true;
    } catch (err) {
      lastDay = null;
      log.warn?.('[recording-retention] daily purge failed:', err?.message || err);
      return false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  setTimeout(() => void tick(), 90_000).unref?.();
  return { tick, timer };
}

module.exports = {
  retentionDays,
  purgeExpiredRecordingsBatch,
  startRecordingRetentionDaily,
};
