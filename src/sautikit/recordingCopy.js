// Copy a provider recording into our Storage bucket.
//
// SautiKit sends the Completed event (with recordingUrl) before the file is in
// storage.sautikit.com, so an immediate GET returns 404 for a few seconds
// (HD_b401138c8ffd, HD_923e63f8a72b: 404 at +0.3s, 200 minutes later).
// The provider URL is saved first; this copy runs in the background and retries
// 404/403 at ~2, 5, 10, 20 and 40s. If every try fails the call is marked
// recording_status='pending_copy' and the sweep retries with a fresh URL.

const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 40000];
const RETRYABLE_STATUSES = new Set([403, 404]);
const PENDING_COPY = 'pending_copy';
const COPY_FAILED = 'copy_failed';
const MAX_SWEEP_ATTEMPTS = 6;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

class RecordingDownloadError extends Error {
  constructor(status) {
    super(`HTTP ${status} downloading recording`);
    this.status = status;
  }
}

async function downloadOnce(url, { fetchImpl = fetch, authHeader } = {}) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new RecordingDownloadError(response.status);
  const contentType =
    (response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : null) || 'audio/mpeg';
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
}

function extensionFor(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : 'mp3';
}

/**
 * Download with retry on 404/403, then upload. Network errors retry too.
 * Other HTTP errors (e.g. 410, 500) stop early.
 * Returns { ok, recordingUrl, recordingPath, attempts, lastError, lastStatus }.
 */
async function copyRecordingWithRetry({
  callSid,
  url,
  recordingSid,
  authHeader,
  upload,
  fetchImpl = fetch,
  delays = RETRY_DELAYS_MS,
  sleep = defaultSleep,
  log = console,
} = {}) {
  let attempts = 0;
  let lastError = null;
  let lastStatus = null;
  const schedule = [0, ...delays];
  for (let i = 0; i < schedule.length; i += 1) {
    if (schedule[i] > 0) await sleep(schedule[i]);
    attempts += 1;
    try {
      const { buffer, contentType } = await downloadOnce(url, { fetchImpl, authHeader });
      const uploaded = await upload({
        callSid,
        recordingSid,
        buffer,
        contentType,
        extension: extensionFor(contentType, url),
      });
      if (attempts > 1) {
        log.log?.(`[recording-copy] copied callSid=${callSid} attempt=${attempts}`);
      }
      return {
        ok: true,
        recordingUrl: uploaded?.recordingUrl || null,
        recordingPath: uploaded?.recordingPath || null,
        attempts,
      };
    } catch (err) {
      lastError = err;
      lastStatus = err?.status || null;
      const retryable = lastStatus == null || RETRYABLE_STATUSES.has(lastStatus);
      if (!retryable) break;
    }
  }
  log.warn?.(
    `[recording-copy] gave up callSid=${callSid} attempts=${attempts}:`,
    lastError?.message || lastError
  );
  return { ok: false, attempts, lastError, lastStatus };
}

module.exports = {
  RETRY_DELAYS_MS,
  PENDING_COPY,
  COPY_FAILED,
  MAX_SWEEP_ATTEMPTS,
  RecordingDownloadError,
  copyRecordingWithRetry,
  extensionFor,
};
