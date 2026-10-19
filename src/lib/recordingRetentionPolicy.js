'use strict';

/** Stored sentinel: never delete recordings for this scope. */
const RETENTION_NEVER = -1;
const RETENTION_MIN_DAYS = 7;
const RETENTION_MAX_DAYS = 365;
const RETENTION_DEFAULT_DAYS = 30;

function envRetentionDays() {
  const n = Number(process.env.RECORDING_RETENTION_DAYS);
  if (!Number.isFinite(n)) return RETENTION_DEFAULT_DAYS;
  if (n < 0) return RETENTION_NEVER;
  if (n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS) return Math.floor(n);
  return RETENTION_DEFAULT_DAYS;
}

/**
 * Parse admin/DB value. null = inherit. -1 = never. 7-365 = days.
 * @returns {number | null}
 */
function parseRetentionStored(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw === 'never' || raw === 'Never') return RETENTION_NEVER;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (n === RETENTION_NEVER) return RETENTION_NEVER;
  if (n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS) return n;
  return null;
}

/**
 * @returns {number | 'never'}
 */
function resolveEffectiveRetentionDays({ tenantOverride, platformDays, envDays } = {}) {
  const tenant = parseRetentionStored(tenantOverride);
  if (tenant === RETENTION_NEVER) return 'never';
  if (typeof tenant === 'number') return tenant;

  const platform = parseRetentionStored(platformDays);
  if (platform === RETENTION_NEVER) return 'never';
  if (typeof platform === 'number') return platform;

  const env = parseRetentionStored(envDays ?? envRetentionDays());
  if (env === RETENTION_NEVER) return 'never';
  if (typeof env === 'number') return env;
  return RETENTION_DEFAULT_DAYS;
}

function cutoffIsoForRetentionDays(days) {
  const d = days === 'never' ? null : Math.floor(Number(days));
  if (!d || d < RETENTION_MIN_DAYS) return null;
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

function callEligibleForRetentionPurge(createdAt, effectiveDays) {
  if (effectiveDays === 'never') return false;
  const cutoff = cutoffIsoForRetentionDays(effectiveDays);
  if (!cutoff) return false;
  return String(createdAt || '') < cutoff;
}

function retentionShowsNote(effective) {
  return effective !== 'never';
}

function retentionNoteCopy(effective) {
  if (!retentionShowsNote(effective)) return null;
  const n = effective === 'never' ? RETENTION_DEFAULT_DAYS : effective;
  return `Recordings are kept for ${n} days.`;
}

function retentionDeletedCopy(effective) {
  if (!retentionShowsNote(effective)) return null;
  const n = effective === 'never' ? RETENTION_DEFAULT_DAYS : effective;
  return `Recording deleted after ${n} days`;
}

/**
 * Shortest retention window in use anywhere (for SQL prefilter). null = no tenant uses finite retention.
 */
function minActiveRetentionDays({ platformDays, overrides, envDays } = {}) {
  const candidates = [];
  const env = parseRetentionStored(envDays ?? envRetentionDays());
  if (typeof env === 'number' && env !== RETENTION_NEVER) candidates.push(env);

  const platform = parseRetentionStored(platformDays);
  if (typeof platform === 'number' && platform !== RETENTION_NEVER) candidates.push(platform);

  const map = overrides instanceof Map ? overrides : new Map(Object.entries(overrides || {}));
  for (const ov of map.values()) {
    const t = parseRetentionStored(ov);
    if (typeof t === 'number' && t !== RETENTION_NEVER) candidates.push(t);
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

module.exports = {
  RETENTION_NEVER,
  RETENTION_MIN_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_DEFAULT_DAYS,
  envRetentionDays,
  parseRetentionStored,
  resolveEffectiveRetentionDays,
  cutoffIsoForRetentionDays,
  callEligibleForRetentionPurge,
  retentionShowsNote,
  retentionNoteCopy,
  retentionDeletedCopy,
  minActiveRetentionDays,
};
