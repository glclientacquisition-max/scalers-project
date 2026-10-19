'use strict';

const {
  RETENTION_MIN_DAYS,
  envRetentionDays,
  resolveEffectiveRetentionDays,
  callEligibleForRetentionPurge,
} = require('./recordingRetentionPolicy');

/**
 * Platform default + per-tenant overrides for recording purge (runtime, no redeploy).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
async function loadRecordingRetentionContext(client) {
  let platformDays = null;
  try {
    const { data, error } = await client
      .from('platform_ops_settings')
      .select('recording_retention_days')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      if (!/recording_retention_days|schema cache/i.test(error.message || '')) throw error;
    } else if (data && data.recording_retention_days != null) {
      platformDays = data.recording_retention_days;
    }
  } catch (err) {
    if (!/recording_retention_days|schema cache/i.test(err?.message || '')) throw err;
  }

  const overrides = new Map();
  try {
    const { data, error } = await client
      .from('tenants')
      .select('id, recording_retention_days_override');
    if (error) {
      if (!/recording_retention_days_override|schema cache/i.test(error.message || '')) throw error;
    } else {
      for (const row of data || []) {
        if (row?.id != null && row.recording_retention_days_override != null) {
          overrides.set(String(row.id), row.recording_retention_days_override);
        }
      }
    }
  } catch (err) {
    if (!/recording_retention_days_override|schema cache/i.test(err?.message || '')) throw err;
  }

  return { platformDays, overrides, envDays: envRetentionDays() };
}

function effectiveRetentionForTenant(context, tenantId) {
  const override = tenantId ? context.overrides.get(String(tenantId)) : undefined;
  return resolveEffectiveRetentionDays({
    tenantOverride: override,
    platformDays: context.platformDays,
    envDays: context.envDays,
  });
}

/**
 * Count calls that the next purge run would delete (approximate; scans up to maxScan rows).
 */
function countPurgeCandidatesFromRows(rows, context, { proposedPlatformDays } = {}) {
  const platformDays =
    proposedPlatformDays !== undefined ? proposedPlatformDays : context.platformDays;
  let count = 0;
  for (const row of rows) {
    const effective = resolveEffectiveRetentionDays({
      tenantOverride: row.tenant_id ? context.overrides.get(String(row.tenant_id)) : undefined,
      platformDays,
      envDays: context.envDays,
    });
    if (callEligibleForRetentionPurge(row.created_at, effective)) count += 1;
  }
  return count;
}

module.exports = {
  loadRecordingRetentionContext,
  effectiveRetentionForTenant,
  countPurgeCandidatesFromRows,
  RETENTION_MIN_DAYS,
};
