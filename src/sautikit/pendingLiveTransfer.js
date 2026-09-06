// Pending live transfer: conference hold + outbound REST (cold Dial is leftover).

const pendingByCall = new Map();
const voiceHttpBaseByCall = new Map();

function escapeXml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXmlAttr(raw) {
  return escapeXml(raw).replace(/'/g, '&apos;');
}

function conferenceRoomName(callSid) {
  const raw = String(callSid || '').replace(/[^a-zA-Z0-9]/g, '');
  const tail = (raw.slice(-16) || 'room').toLowerCase();
  return `xfer${tail}`;
}

function rememberCallVoiceHttpBase(callSid, baseUrl) {
  const sid = String(callSid || '').trim();
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!sid || !base) return;
  voiceHttpBaseByCall.set(sid, base);
}

function getCallVoiceHttpBase(callSid) {
  return voiceHttpBaseByCall.get(String(callSid || '').trim()) || null;
}

function envPublicVoiceHttpBase() {
  const raw =
    process.env.VOICE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  return String(raw).replace(/\/+$/, '') || null;
}

function buildDialXml({ to, callerId, timeoutS = 30 } = {}) {
  const dest = escapeXml(to);
  const from = escapeXml(callerId || '');
  const timeout = Math.min(60, Math.max(10, Number(timeoutS) || 30));
  const callerAttr = from ? ` callerId="${from}"` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Dial${callerAttr} timeout="${timeout}" record="true"><Number>${dest}</Number></Dial>\n` +
    `</Response>`
  );
}

function buildTransferFallbackXml() {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Say>I could not reach the team just now. They have your message and will follow up.</Say>\n` +
    `  <Hangup/>\n` +
    `</Response>`
  );
}

function emptyVoiceXml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

/**
 * Stream connect=true holds the PSTN on the fork. Verbs after Stream never ran
 * on staging. Keep this for callback tenants (flag off).
 */
function buildAnswerStreamXml({ streamUrl, continueUrl } = {}) {
  const url = escapeXmlAttr(streamUrl);
  const next = escapeXml(continueUrl);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `    <Stream url="${url}" name="ai-receptionist" track="inbound_track" connect="true" outputSamplingRate="16000" bidirectionalSamplingRate="16000" />\n` +
    `    <Redirect method="POST">${next}</Redirect>\n` +
    `</Response>`
  );
}

/**
 * Flag on: Stream without connect so Conference can hold the PSTN. AI still
 * forks to /ws/media. Teammate later POST /v1/calls into the same room.
 */
function buildAnswerConferenceHoldXml({ streamUrl, room } = {}) {
  const url = escapeXmlAttr(streamUrl);
  const name = escapeXml(room);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `    <Stream url="${url}" name="ai-receptionist" track="inbound_track" connect="false" outputSamplingRate="16000" bidirectionalSamplingRate="16000" />\n` +
    `    <Conference startOnEnter="true" endOnExit="false" beep="false">${name}</Conference>\n` +
    `</Response>`
  );
}

function buildAgentJoinConferenceXml({ room } = {}) {
  const name = escapeXml(room);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Say>You have a caller on the line.</Say>\n` +
    `  <Conference startOnEnter="true" endOnExit="true" beep="true">${name}</Conference>\n` +
    `</Response>`
  );
}

function transferTimeoutSeconds() {
  return Math.min(60, Math.max(10, Number(process.env.VOICE_TRANSFER_TIMEOUT_S || 30) || 30));
}

function queuePendingLiveTransfer({
  callSid,
  to,
  callerId,
  timeoutS,
  room,
  mode,
} = {}) {
  const sid = String(callSid || '').trim();
  const dest = String(to || '').trim();
  if (!sid || !dest) return null;
  const existing = pendingByCall.get(sid);
  if (existing && (existing.status === 'pending' || existing.status === 'ringing' || existing.status === 'dialing')) {
    return existing;
  }
  const row = {
    callSid: sid,
    to: dest,
    callerId: String(callerId || '').trim() || null,
    timeoutS: timeoutS || transferTimeoutSeconds(),
    room: room || conferenceRoomName(sid),
    mode: mode === 'cold_dial' ? 'cold_dial' : 'conference',
    status: 'pending',
    queuedAt: Date.now(),
  };
  pendingByCall.set(sid, row);
  return row;
}

function markPendingLiveTransfer(callSid, patch = {}) {
  const sid = String(callSid || '').trim();
  const row = pendingByCall.get(sid);
  if (!row) return null;
  Object.assign(row, patch);
  pendingByCall.set(sid, row);
  return row;
}

function hasPendingLiveTransfer(callSid) {
  const row = pendingByCall.get(String(callSid || ''));
  return Boolean(
    row &&
      (row.status === 'pending' || row.status === 'ringing' || row.status === 'dialing')
  );
}

function getPendingLiveTransfer(callSid) {
  return pendingByCall.get(String(callSid || '')) || null;
}

function clearPendingLiveTransfer(callSid) {
  pendingByCall.delete(String(callSid || ''));
}

function eventBlob(callSessionState, body = {}) {
  return `${callSessionState || ''} ${body.streamEvent || ''} ${body.CallSessionState || ''} ${body.status || ''}`.toLowerCase();
}

function isStreamStopEvent(blob) {
  return /streamstop|stream-stop|streamerror|stream-error/.test(blob);
}

function isDialFailEvent(blob) {
  return /\bbusy\b|no-answer|noanswer|no_answer|\bfailed\b|\btimeout\b/.test(blob);
}

function isCompletedEvent(blob) {
  return /\bcompleted\b|\bhangup\b/.test(blob);
}

/**
 * Cold Dial leftover. Conference pending must not return Dial on Completed
 * (staging returned Dial after hangup).
 */
function consumeLiveTransferWebhook({ callSid, callSessionState, body, source } = {}) {
  const sid = String(callSid || '').trim();
  if (!sid) return null;
  const row = pendingByCall.get(sid);
  if (!row) return null;
  if (row.mode === 'conference') return null;
  const blob = eventBlob(callSessionState, body);
  const fromContinue = source === 'redirect' || source === 'transfer_continue';

  if (row.status === 'pending') {
    if (
      fromContinue ||
      isStreamStopEvent(blob) ||
      (isCompletedEvent(blob) && !isDialFailEvent(blob))
    ) {
      row.status = 'dialing';
      pendingByCall.set(sid, row);
      return {
        xml: buildDialXml(row),
        action: 'dial',
        attempt: row,
      };
    }
    return null;
  }

  if (row.status === 'dialing') {
    if (isDialFailEvent(blob)) {
      row.status = 'failed';
      pendingByCall.set(sid, row);
      return {
        xml: buildTransferFallbackXml(),
        action: 'fallback',
        attempt: row,
      };
    }
    if (isCompletedEvent(blob) && !isStreamStopEvent(blob)) {
      row.status = 'bridged';
      pendingByCall.set(sid, row);
      return {
        xml: emptyVoiceXml(),
        action: 'bridged',
        attempt: row,
      };
    }
    return {
      xml: emptyVoiceXml(),
      action: 'wait',
      attempt: row,
    };
  }

  return null;
}

function resetPendingLiveTransfersForTests() {
  pendingByCall.clear();
  voiceHttpBaseByCall.clear();
}

module.exports = {
  conferenceRoomName,
  rememberCallVoiceHttpBase,
  getCallVoiceHttpBase,
  envPublicVoiceHttpBase,
  buildDialXml,
  buildTransferFallbackXml,
  buildAnswerStreamXml,
  buildAnswerConferenceHoldXml,
  buildAgentJoinConferenceXml,
  emptyVoiceXml,
  transferTimeoutSeconds,
  queuePendingLiveTransfer,
  markPendingLiveTransfer,
  hasPendingLiveTransfer,
  getPendingLiveTransfer,
  clearPendingLiveTransfer,
  consumeLiveTransferWebhook,
  resetPendingLiveTransfersForTests,
};
