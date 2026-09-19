// Parse SautiKit recording / call-lifecycle webhook envelopes.
// Docs: call.recording.ready uses data.download_url + data.call_id.
// The S3 guide also sends event_kind + payload.call_id with no URL.

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function nested(body = {}) {
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const call = body.call && typeof body.call === 'object' ? body.call : {};
  return { data, payload, call };
}

function extractEventKind(headers = {}, body = {}) {
  return firstString(
    headers['x-sautikit-event-kind'],
    headers['x-sautikit-event'],
    body.kind,
    body.event_kind,
    body.event_type,
    body.event,
    body.type
  ).toLowerCase();
}

function pushSid(out, value) {
  const text = String(value || '').trim();
  if (!text || out.includes(text)) return;
  out.push(text);
}

function extractEventCallSids(body = {}) {
  const { data, payload, call } = nested(body);
  const sessionFirst = [];
  const rest = [];
  const sessionKeys = [
    body.sessionId,
    body.SessionId,
    data.sessionId,
    data.session_id,
    payload.sessionId,
    payload.session_id,
    call.sessionId,
    call.session_id,
    body.CallSid,
    body.callSid,
    body.call_sid,
    data.call_sid,
    payload.call_sid,
  ];
  const idKeys = [
    body.call_id,
    body.callId,
    body.CallId,
    data.call_id,
    data.callId,
    data.id,
    payload.call_id,
    payload.callId,
    call.call_id,
    call.id,
  ];
  for (const value of sessionKeys) pushSid(sessionFirst, value);
  for (const value of idKeys) pushSid(rest, value);
  const out = [];
  for (const value of sessionFirst) pushSid(out, value);
  for (const value of rest) pushSid(out, value);
  return out;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function extractRecordingFields(body = {}) {
  const { data, payload, call } = nested(body);
  const recording =
    (body.recording && typeof body.recording === 'object' && body.recording) ||
    (data.recording && typeof data.recording === 'object' && data.recording) ||
    (payload.recording && typeof payload.recording === 'object' && payload.recording) ||
    {};
  const url = firstString(
    body.RecordingUrl,
    body.recording_url,
    body.recordingUrl,
    body.download_url,
    body.url,
    data.recording_url,
    data.download_url,
    data.url,
    payload.recording_url,
    payload.download_url,
    payload.url,
    recording.recording_url,
    recording.download_url,
    recording.url,
    call.recording_url,
    call.download_url
  );
  const recordingSid = firstString(
    body.RecordingSid,
    body.recording_sid,
    body.recordingSid,
    body.recording_id,
    data.recording_sid,
    data.recording_id,
    payload.recording_sid,
    payload.recording_id,
    recording.recording_sid,
    recording.id
  );
  return {
    recordingUrl: looksLikeUrl(url) ? url : null,
    recordingSid: recordingSid || null,
    callSids: extractEventCallSids(body),
  };
}

function isRecordingEvent(kind = '', body = {}) {
  const blob = `${kind} ${body.kind || ''} ${body.event_kind || ''} ${body.event_type || ''} ${body.event || ''} ${body.type || ''}`.toLowerCase();
  if (blob.includes('recording')) return true;
  const rec = extractRecordingFields(body);
  return Boolean(rec.recordingUrl || rec.recordingSid);
}

module.exports = {
  extractEventKind,
  extractEventCallSids,
  extractRecordingFields,
  isRecordingEvent,
};
