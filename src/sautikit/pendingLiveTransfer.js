// In-memory pending cold Dial after the AI Stream stops.

const pendingByCall = new Map();

function escapeXml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function escapeXmlAttr(raw) {
  return escapeXml(raw).replace(/'/g, '&apos;');
}

/**
 * Answer XML: hold the PSTN on Stream, then continue to Redirect when the
 * media socket closes. Staging showed StreamStopped never hits /voice/incoming
 * (it rides events_url, which cannot return Dial).
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

function transferTimeoutSeconds() {
  return Math.min(60, Math.max(10, Number(process.env.VOICE_TRANSFER_TIMEOUT_S || 30) || 30));
}

function queuePendingLiveTransfer({ callSid, to, callerId, timeoutS } = {}) {
  const sid = String(callSid || '').trim();
  const dest = String(to || '').trim();
  if (!sid || !dest) return null;
  const existing = pendingByCall.get(sid);
  if (existing && (existing.status === 'pending' || existing.status === 'dialing')) {
    return existing;
  }
  const row = {
    callSid: sid,
    to: dest,
    callerId: String(callerId || '').trim() || null,
    timeoutS: timeoutS || transferTimeoutSeconds(),
    status: 'pending',
    queuedAt: Date.now(),
  };
  pendingByCall.set(sid, row);
  return row;
}

function hasPendingLiveTransfer(callSid) {
  const row = pendingByCall.get(String(callSid || ''));
  return Boolean(row && (row.status === 'pending' || row.status === 'dialing'));
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
 * Choose XML for a skip-stream webhook. Null means the caller should keep today's empty Response.
 */
function consumeLiveTransferWebhook({ callSid, callSessionState, body, source } = {}) {
  const sid = String(callSid || '').trim();
  if (!sid) return null;
  const row = pendingByCall.get(sid);
  if (!row) return null;
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
}

module.exports = {
  buildDialXml,
  buildTransferFallbackXml,
  buildAnswerStreamXml,
  emptyVoiceXml,
  transferTimeoutSeconds,
  queuePendingLiveTransfer,
  hasPendingLiveTransfer,
  getPendingLiveTransfer,
  clearPendingLiveTransfer,
  consumeLiveTransferWebhook,
  resetPendingLiveTransfersForTests,
};
