'use strict';

/**
 * Daily data-quality snapshot (public.snapshot_data_quality) when pg_cron is not installed.
 * Hourly tick; the SQL upserts one row per tenant per EAT day, so repeats are harmless.
 */
function eatHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }).format(now)) % 24;
}

function eatDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
}

function startDataQualityDaily({ rpc, hour = 3, intervalMs = 60 * 60 * 1000, log = console } = {}) {
  if (String(process.env.DATA_QUALITY_DAILY || 'on').toLowerCase() === 'off') return null;
  let lastDay = null;
  const tick = async (now = new Date()) => {
    const day = eatDay(now);
    if (day === lastDay || eatHour(now) < hour) return false;
    lastDay = day;
    try {
      const { data, error } = await rpc('snapshot_data_quality');
      if (error) throw error;
      log.info?.(`[data-quality] snapshot ${day}: ${data} tenants`);
      return true;
    } catch (err) {
      lastDay = null;
      log.warn?.('[data-quality] snapshot failed:', err?.message || err);
      return false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { tick, timer };
}

module.exports = { startDataQualityDaily, eatDay, eatHour };
