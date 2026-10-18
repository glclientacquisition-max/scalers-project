'use strict';

/**
 * Daily purge of call recordings past RECORDING_RETENTION_DAYS (default 30).
 * Uses the same hourly EAT tick as snapshot_data_quality (no pg_cron).
 *
 * SautiKit: we attempt DELETE /v1/calls/{id}/recording when purging. If the
 * API returns 404/405/501, provider-side retention applies (see recordingFetch).
 */

const { eatDay, eatHour } = require('./dataQualityDaily');

function retentionDays() {
  const n = Number(process.env.RECORDING_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

/**
 * @param {{
 *   listCalls?: typeof import('../db').listCallsForRecordingRetentionPurge,
 *   purgeCall?: typeof import('../db').purgeCallRecordingRetention,
 *   deleteProvider?: (callSid: string) => Promise<{ ok?: boolean }>,
 *   olderThanDays?: number,
 *   batchSize?: number,
 *   log?: Console,
 * }} deps
 */
async function purgeExpiredRecordingsBatch(deps = {}) {
  const log = deps.log || console;
  const days = deps.olderThanDays ?? retentionDays();
  const limit = deps.batchSize ?? 50;
  const listCalls = deps.listCalls;
  const purgeCall = deps.purgeCall;
  const deleteProvider = deps.deleteProvider;
  if (!listCalls || !purgeCall) {
    throw new Error('[recording-retention] listCalls and purgeCall required');
  }

  const rows = await listCalls({ olderThanDays: days, limit });
  let purged = 0;
  let skipped = 0;
  for (const row of rows) {
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
  if (purged || rows.length) {
    log.info?.(
      `[recording-retention] batch days=${days} candidates=${rows.length} purged=${purged} skipped=${skipped}`
    );
  }
  return { candidates: rows.length, purged, skipped };
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
      await purgeBatch({ olderThanDays: retentionDays() });
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
