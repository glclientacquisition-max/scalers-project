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

module.exports = {
  fetchCallRecording,
};
