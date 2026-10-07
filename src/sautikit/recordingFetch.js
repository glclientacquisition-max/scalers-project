// GET /v1/calls/{id}/recording → 302 Location (presigned URL).
// Docs: https://sautikit.com/developers/guides/record-and-stream-to-s3

const DEFAULT_API_BASE = 'https://api.sautikit.com';

function apiBase(value) {
  return String(value || process.env.SAUTIKIT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
}

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  return String(headers[name] || headers[name.toLowerCase()] || '').trim();
}

function sessionIdFromCallJson(json) {
  if (!json || typeof json !== 'object') return '';
  const data = json.data && typeof json.data === 'object' ? json.data : {};
  return String(
    json.session_id ||
      json.sessionId ||
      json.call_sid ||
      data.session_id ||
      data.sessionId ||
      ''
  ).trim();
}

function downloadUrlFromJson(json) {
  if (!json || typeof json !== 'object') return '';
  const data = json.data && typeof json.data === 'object' ? json.data : {};
  return String(
    json.download_url ||
      json.recording_url ||
      json.url ||
      data.download_url ||
      data.recording_url ||
      ''
  ).trim();
}

/**
 * @param {string} callId
 * @param {{ apiKey?: string, apiBase?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ downloadUrl: string|null, sessionId: string|null, status: number|string }>}
 */
async function fetchCallRecording(callId, opts = {}) {
  const id = String(callId || '').trim();
  const apiKey = String(opts.apiKey || process.env.SAUTIKIT_API_KEY || '').trim();
  if (!id) return { downloadUrl: null, sessionId: null, status: 'missing_id' };
  if (!apiKey) return { downloadUrl: null, sessionId: null, status: 'not_configured' };

  const base = apiBase(opts.apiBase);
  const fetchImpl = opts.fetchImpl || fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  let downloadUrl = null;
  let sessionId = null;
  let status = 0;

  try {
    const recRes = await fetchImpl(`${base}/v1/calls/${encodeURIComponent(id)}/recording`, {
      method: 'GET',
      headers,
      redirect: 'manual',
    });
    status = recRes.status;
    const location = readHeader(recRes.headers, 'location');
    if ((status === 302 || status === 301 || status === 303 || status === 307) && location) {
      downloadUrl = location;
    } else if (recRes.ok) {
      let json = null;
      try {
        json = await recRes.json();
      } catch {
        json = null;
      }
      const fromBody = downloadUrlFromJson(json);
      if (fromBody) downloadUrl = fromBody;
      sessionId = sessionIdFromCallJson(json) || null;
    } else if (status === 404 || status === 410 || status === 202) {
      return { downloadUrl: null, sessionId: null, status };
    }
  } catch (err) {
    console.warn(
      `[sautikit] recording fetch failed for ${id}:`,
      err?.message || err
    );
    return { downloadUrl: null, sessionId: null, status: 'error' };
  }

  if (!sessionId) {
    try {
      const callRes = await fetchImpl(`${base}/v1/calls/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers,
      });
      if (callRes.ok) {
        const json = await callRes.json();
        sessionId = sessionIdFromCallJson(json) || null;
      }
    } catch {
      /* session id is optional */
    }
  }

  return {
    downloadUrl: downloadUrl || null,
    sessionId: sessionId || null,
    status,
  };
}

const RECORDING_BACKOFF_MS = [800, 2400, 6000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After hangup, the recording URL can 404 until SautiKit finishes the file.
 * Retry with backoff. A final 404 is recording_status=missing. This does not
 * throw, so the caller can run it off the hangup and wallet path.
 *
 * @param {string} callId
 * @param {{ delays?: number[], sleep?: (ms: number) => Promise<void>, apiKey?: string, apiBase?: string, fetchImpl?: typeof fetch }} [opts]
 */
async function fetchCallRecordingWithBackoff(callId, opts = {}) {
  const delays = Array.isArray(opts.delays) ? opts.delays : [0, ...RECORDING_BACKOFF_MS];
  const wait = opts.sleep || sleep;
  let last = { downloadUrl: null, sessionId: null, status: 'missing_id' };
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    last = await fetchCallRecording(callId, opts);
    if (last.downloadUrl) {
      return { ...last, recordingStatus: 'ready', attempts: attempt + 1 };
    }
    if (last.status !== 404 && last.status !== 410 && last.status !== 202) {
      return { ...last, recordingStatus: 'error', attempts: attempt + 1 };
    }
  }
  return {
    ...last,
    downloadUrl: null,
    recordingStatus: 'missing',
    attempts: delays.length,
  };
}

module.exports = {
  fetchCallRecording,
  fetchCallRecordingWithBackoff,
  RECORDING_BACKOFF_MS,
};
