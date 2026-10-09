// Caller-audio clock for one media socket.
//
// The carrier streams caller audio for the whole call (~50 frames/s, also in
// silence). HD_b82fbfef7649: 8067 frames = 161 s, carrier said 162 s, but the
// socket stayed open to 193 s. After the caller hung up the agent kept
// talking (second goodbye, idle nudge) into a dead line for ~30 s.

function flagOn(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/** VOICE_DURATION_PREFER_VENDOR=off restores "socket lifetime, largest wins". */
function preferVendorDuration(env = process.env) {
  return flagOn(env.VOICE_DURATION_PREFER_VENDOR);
}

/**
 * Media fallback duration for the call row.
 * Caller-audio span when frames arrived, else socket lifetime.
 */
function mediaDurationSeconds({ firstFrameAt = 0, lastFrameAt = 0, connectedAt = 0, closedAt = 0, env = process.env } = {}) {
  const lifetime = Math.max(0, Math.round((Number(closedAt) - Number(connectedAt)) / 1000));
  if (!preferVendorDuration(env)) return lifetime;
  const first = Number(firstFrameAt) || 0;
  const last = Number(lastFrameAt) || 0;
  if (first > 0 && last >= first) return Math.max(0, Math.round((last - first) / 1000));
  return lifetime;
}

/**
 * No caller audio for this long means the caller is gone.
 * VOICE_MEDIA_STALL_MS=0 turns the watchdog off. Default 10 s.
 */
function mediaStallMs(env = process.env) {
  const raw = env.VOICE_MEDIA_STALL_MS;
  if (raw == null || String(raw).trim() === '') return 10000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 10000;
  if (n <= 0) return 0;
  return Math.min(60000, Math.max(4000, n));
}

function isMediaStalled({ lastFrameAt = 0, now = Date.now(), stallMs = 10000 } = {}) {
  if (!stallMs || !lastFrameAt) return false;
  return Number(now) - Number(lastFrameAt) >= stallMs;
}

module.exports = {
  isMediaStalled,
  mediaDurationSeconds,
  mediaStallMs,
  preferVendorDuration,
};
