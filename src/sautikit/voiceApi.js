// SautiKit REST for outbound PSTN (live transfer). Key stays server-side.

function sautikitApiBase() {
  return String(process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com').replace(/\/+$/, '');
}

function normalizeSautikitApiKey(raw) {
  let key = String(raw || '').trim();
  if (key.startsWith('SAUTIKIT_API_KEY=')) key = key.slice('SAUTIKIT_API_KEY='.length).trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (/^Bearer\s+/i.test(key)) key = key.replace(/^Bearer\s+/i, '').trim();
  return key;
}

function getSautikitApiKey() {
  return normalizeSautikitApiKey(process.env.SAUTIKIT_API_KEY);
}

function isSautikitApiConfigured() {
  return Boolean(getSautikitApiKey());
}

/**
 * Place an outbound call. `to` is one E.164. OpenAPI requires `to` as an array.
 * @param {{ from: string, to: string, voiceCallbackUrl: string, clientRequestId?: string, fetchImpl?: typeof fetch }} opts
 */
async function originateOutboundCall({
  from,
  to,
  voiceCallbackUrl,
  clientRequestId,
  fetchImpl,
} = {}) {
  const key = getSautikitApiKey();
  if (!key) return { ok: false, reason: 'no_api_key' };
  const dest = String(to || '').trim();
  const caller = String(from || '').trim();
  const callback = String(voiceCallbackUrl || '').trim();
  if (!dest || !caller || !callback) {
    return { ok: false, reason: 'missing_params' };
  }
  const idem = String(clientRequestId || `xfer-${Date.now()}`).replace(/[^\w.:-]/g, '').slice(0, 64);
  const doFetch = fetchImpl || fetch;
  let res;
  try {
    res = await doFetch(`${sautikitApiBase()}/v1/calls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        from: caller,
        to: [dest],
        voice_callback_url: callback,
        client_request_id: idem,
      }),
    });
  } catch (err) {
    return { ok: false, reason: 'network', error: err?.message || String(err) };
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status !== 201) {
    const code = json?.error?.code || `http_${res.status}`;
    return { ok: false, reason: code, status: res.status, body: json || text };
  }
  return {
    ok: true,
    callId: json?.call_id || null,
    sessionId: json?.session_id || null,
    status: json?.status || 'ringing',
    raw: json,
  };
}

module.exports = {
  sautikitApiBase,
  normalizeSautikitApiKey,
  getSautikitApiKey,
  isSautikitApiConfigured,
  originateOutboundCall,
};
