// Conference live transfer.
// Cold Dial after Stream does not run on SautiKit (staging 2026-09-06).
// This executor puts the inbound leg in a named conference, then
// POST /v1/calls so the directory phone joins the same room.
// Outbound PSTN is not placed until the caller join event.

const { canOriginateOutboundTransfer, envTransferRateKesPerMin } = require('../billing/liveTransferLegs');

const byCall = new Map();
const byRoom = new Map();
const byOutbound = new Map();

const FALLBACK_SAY =
  'I could not reach the team just now. They have your message and will follow up.';

function maskE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 4) return 'hidden';
  return `***${digits.slice(-4)}`;
}

function phoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function conferenceRoomName(callSid) {
  const raw = String(callSid || '').replace(/[^A-Za-z0-9._-]/g, '');
  const tail = (raw || 'call').slice(-48);
  return `scalers-${tail}`.slice(0, 64);
}

function clientRequestIdFor(callSid) {
  const raw = String(callSid || '').replace(/[^A-Za-z0-9._-]/g, '');
  const id = `xfer-${raw || 'call'}`.slice(0, 80);
  if (id.startsWith('mcp:') || id.startsWith('broadcast:')) return `xfer-call`;
  return id;
}

function buildCallerConferenceDocument(state) {
  return {
    actions: [
      { say: { text: 'Okay, let me connect you.' } },
      {
        conference: {
          name: state.room,
          startOnEnter: false,
          endOnExit: false,
          beep: false,
          maxParticipants: 2,
          record: true,
          statusEventsCallbackUrl: state.eventsUrl,
          statusEvents: 'start end join leave',
        },
      },
    ],
  };
}

function buildAgentConferenceDocument(state) {
  return {
    actions: [
      {
        conference: {
          name: state.room,
          startOnEnter: true,
          endOnExit: true,
          beep: true,
          maxParticipants: 2,
          record: true,
          statusEventsCallbackUrl: state.eventsUrl,
          statusEvents: 'start end join leave',
        },
      },
    ],
  };
}

function buildFallbackDocument() {
  return {
    actions: [{ say: { text: FALLBACK_SAY } }, { hangup: {} }],
  };
}

function buildHangupDocument() {
  return { actions: [{ hangup: {} }] };
}

function buildOriginateBody({ from, to, voiceCallbackUrl, clientRequestId }) {
  return {
    from,
    to: [to],
    voice_callback_url: voiceCallbackUrl,
    client_request_id: clientRequestId,
  };
}

function armConferenceTransfer({
  callSid,
  to,
  callerId,
  callerNumber,
  timeoutS,
  eventsUrl,
  agentUrl,
  fallbackUrl,
  billingEnforcement,
  walletBalanceKes,
} = {}) {
  const sid = String(callSid || '').trim();
  const dest = String(to || '').trim();
  const from = String(callerId || '').trim();
  if (!sid || !dest || !from) return null;
  if (!eventsUrl || !agentUrl || !fallbackUrl) return null;
  const existing = byCall.get(sid);
  if (
    existing &&
    (existing.status === 'armed' ||
      existing.status === 'caller_holding' ||
      existing.status === 'dialing' ||
      existing.status === 'bridged')
  ) {
    return existing;
  }
  const room = conferenceRoomName(sid);
  const row = {
    callSid: sid,
    room,
    to: dest,
    callerId: from,
    callerNumber: String(callerNumber || '').trim() || null,
    timeoutS: Math.min(60, Math.max(10, Number(timeoutS) || 30)),
    eventsUrl: String(eventsUrl),
    agentUrl: String(agentUrl),
    fallbackUrl: String(fallbackUrl),
    billingEnforcement: billingEnforcement || null,
    walletBalanceKes: walletBalanceKes == null ? null : Number(walletBalanceKes),
    status: 'armed',
    originated: false,
    outboundCallSid: null,
    callerParticipant: null,
    agentParticipant: null,
    armedAt: Date.now(),
  };
  byCall.set(sid, row);
  byRoom.set(room, sid);
  return row;
}

function getConferenceTransfer(callSid) {
  return byCall.get(String(callSid || '').trim()) || null;
}

function getConferenceTransferByRoom(room) {
  const sid = byRoom.get(String(room || '').trim());
  return sid ? byCall.get(sid) || null : null;
}

function parentCallForOutbound(outboundCallSid) {
  const sid = byOutbound.get(String(outboundCallSid || '').trim());
  return sid ? byCall.get(sid) || null : null;
}

function conferenceKeepsCallOpen(callSid) {
  const row = getConferenceTransfer(callSid);
  return Boolean(
    row &&
      (row.status === 'armed' ||
        row.status === 'caller_holding' ||
        row.status === 'dialing' ||
        row.status === 'bridged')
  );
}

function eventBlob(callSessionState, body = {}) {
  return `${callSessionState || ''} ${body.callSessionState || ''} ${body.CallSessionState || ''} ${body.streamEvent || ''} ${body.status || ''}`.toLowerCase();
}

function isStreamStopEdge(callSessionState, body = {}) {
  return /streamstop|stream-stop|streamerror|stream-error/.test(eventBlob(callSessionState, body));
}

function isTerminalVoiceEdge(callSessionState, body = {}) {
  const blob = eventBlob(callSessionState, body);
  if (isStreamStopEdge(callSessionState, body)) return false;
  return /\bcompleted\b|\bhangup\b|\bfailed\b|\bbusy\b|no-answer|noanswer|no_answer|\bcancel/.test(
    blob
  );
}

/**
 * Voice callback while a conference transfer is armed.
 * Completed/hangup must not admit the caller: that webhook arrives after the
 * leg is already gone (staging Dial-on-Completed).
 */
function decideTransferContinue({ callSid, callSessionState, body, source } = {}) {
  const row = getConferenceTransfer(callSid);
  if (!row) return null;
  if (row.status === 'failed' || row.status === 'cancelled' || row.status === 'bridged') {
    return { kind: 'empty', attempt: row };
  }
  const terminal = isTerminalVoiceEdge(callSessionState, body);
  const admit =
    source === 'transfer_continue' ||
    source === 'redirect' ||
    isStreamStopEdge(callSessionState, body);
  if ((row.status === 'armed' || row.status === 'caller_holding') && admit && !terminal) {
    row.status = 'caller_holding';
    byCall.set(row.callSid, row);
    return { kind: 'caller_conference', document: buildCallerConferenceDocument(row), attempt: row };
  }
  if (terminal) {
    return { kind: 'terminal_drop', attempt: row };
  }
  return { kind: 'empty', attempt: row };
}

function decideAgentJoin({ callSid, room } = {}) {
  const row = getConferenceTransfer(callSid) || getConferenceTransferByRoom(room);
  if (!row || row.status === 'failed' || row.status === 'cancelled') {
    return { kind: 'hangup', document: buildHangupDocument(), attempt: row };
  }
  return { kind: 'agent_conference', document: buildAgentConferenceDocument(row), attempt: row };
}

function parseConferenceEvent(body = {}) {
  const event = String(
    body.event || body.Event || body.conferenceEvent || body.status || ''
  )
    .trim()
    .toLowerCase();
  const room = String(
    body.conference_name ||
      body.conferenceRoomName ||
      body.conferenceName ||
      body.room ||
      body.ConferenceName ||
      ''
  ).trim();
  const caller = String(
    body.caller || body.callerNumber || body.Caller || body.participantNumber || ''
  ).trim();
  const participantId = String(
    body.participant_id || body.participantId || body.conferenceParticipantId || ''
  ).trim();
  const participants = Number(body.participants);
  return {
    event,
    room,
    caller,
    participantId: participantId || null,
    participants: Number.isFinite(participants) ? participants : null,
  };
}

function resolveConferenceState({ callSid, room, body } = {}) {
  return (
    getConferenceTransfer(callSid) ||
    getConferenceTransferByRoom(room) ||
    getConferenceTransferByRoom(parseConferenceEvent(body || {}).room)
  );
}

/**
 * @returns {{ action: string, attempt: object|null, originate?: boolean }}
 */
function decideConferenceEvent({ callSid, room, body } = {}) {
  const row = resolveConferenceState({ callSid, room, body });
  if (!row) return { action: 'ignore', attempt: null };
  if (row.status === 'failed' || row.status === 'cancelled') {
    return { action: 'ignore', attempt: row };
  }
  const parsed = parseConferenceEvent(body || {});
  if (parsed.event !== 'join' && parsed.event !== 'leave' && parsed.event !== 'end') {
    return { action: 'ignore', attempt: row };
  }
  const who = phoneDigits(parsed.caller);
  const isCaller = Boolean(who && who === phoneDigits(row.callerNumber));
  const isAgent = Boolean(who && who === phoneDigits(row.to));

  if (parsed.event === 'join') {
    if (isAgent || (row.originated && !isCaller)) {
      row.status = 'bridged';
      if (parsed.participantId) row.agentParticipant = parsed.participantId;
      byCall.set(row.callSid, row);
      return { action: 'bridged', attempt: row };
    }
    if (parsed.participantId) row.callerParticipant = parsed.participantId;
    if (row.status === 'armed') row.status = 'caller_holding';
    byCall.set(row.callSid, row);
    return { action: 'caller_joined', attempt: row, originate: !row.originated };
  }

  if ((parsed.event === 'leave' || parsed.event === 'end') && row.status !== 'bridged') {
    return { action: 'caller_left', attempt: row };
  }
  return { action: 'ignore', attempt: row };
}

function claimOriginate(callSid) {
  const row = getConferenceTransfer(callSid);
  if (!row || row.originated) return null;
  if (row.status === 'failed' || row.status === 'cancelled' || row.status === 'bridged') {
    return null;
  }
  const gate = canOriginateOutboundTransfer({
    billingEnforcement: row.billingEnforcement,
    walletBalanceKes: row.walletBalanceKes,
    rateKesPerMin: envTransferRateKesPerMin(),
  });
  if (!gate.ok) {
    row.status = 'failed';
    row.error = gate.reason;
    byCall.set(row.callSid, row);
    return { denied: true, reason: gate.reason, attempt: row };
  }
  row.originated = true;
  row.status = 'dialing';
  byCall.set(row.callSid, row);
  return { denied: false, attempt: row, gate };
}

function releaseOriginate(callSid) {
  const row = getConferenceTransfer(callSid);
  if (!row || row.status === 'bridged') return row;
  row.originated = false;
  if (row.status === 'dialing') row.status = 'caller_holding';
  byCall.set(row.callSid, row);
  return row;
}

function bindOutboundLeg(callSid, outboundCallSid) {
  const row = getConferenceTransfer(callSid);
  const outbound = String(outboundCallSid || '').trim();
  if (!row || !outbound) return row;
  row.outboundCallSid = outbound;
  byCall.set(row.callSid, row);
  byOutbound.set(outbound, row.callSid);
  return row;
}

function markConferenceStatus(callSid, status, extra = {}) {
  const row = getConferenceTransfer(callSid);
  if (!row) return null;
  row.status = status;
  if (extra.error) row.error = extra.error;
  byCall.set(row.callSid, row);
  return row;
}

function outboundLegResult({ status, durationSeconds, conferenceStatus } = {}) {
  if (conferenceStatus === 'bridged') return 'bridged_end';
  const blob = String(status || '').toLowerCase();
  if (/no[-_]?answer|busy|fail|cancel/.test(blob)) return 'missed';
  if (/complete|hangup|ended/.test(blob)) {
    return Number(durationSeconds) > 0 ? 'bridged_end' : 'missed';
  }
  return 'ignore';
}

function sautikitApiBase() {
  return String(process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com').replace(/\/$/, '');
}

/**
 * Place the directory leg. Caller must already be claimed via claimOriginate.
 * @returns {Promise<{ ok: boolean, reason?: string, status?: number, outboundCallSid?: string|null, body?: object }>}
 */
async function postOutboundTransfer({
  attempt,
  fetchImpl = global.fetch,
  apiKey = process.env.SAUTIKIT_API_KEY,
  apiBase = sautikitApiBase(),
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'no_api_key' };
  if (!attempt?.callerId || !attempt?.to || !attempt?.agentUrl) {
    return { ok: false, reason: 'missing_route' };
  }
  const clientRequestId = clientRequestIdFor(attempt.callSid);
  const payload = buildOriginateBody({
    from: attempt.callerId,
    to: attempt.to,
    voiceCallbackUrl: attempt.agentUrl,
    clientRequestId,
  });
  const res = await fetchImpl(`${apiBase}/v1/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': clientRequestId.slice(0, 64),
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const reason = body?.error?.code || body?.error?.message || `http_${res.status}`;
    return { ok: false, reason: String(reason), status: res.status, body };
  }
  const outboundCallSid = String(body?.session_id || body?.call_id || '').trim() || null;
  return { ok: true, status: res.status, outboundCallSid, body };
}

async function postConferenceCommand({
  room,
  command,
  participant,
  callbackUrl,
  fetchImpl = global.fetch,
  apiKey = process.env.SAUTIKIT_API_KEY,
  apiBase = sautikitApiBase(),
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key || !room || !command) return { ok: false, reason: 'missing_command' };
  const payload = {
    command,
    participant: participant || undefined,
    callback_url: callbackUrl || undefined,
    extra: callbackUrl ? { callback_url: callbackUrl } : undefined,
  };
  const res = await fetchImpl(
    `${apiBase}/v1/conferences/${encodeURIComponent(room)}/commands`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  return { ok: res.ok, status: res.status };
}

async function hangupOutboundLeg({
  outboundCallSid,
  fetchImpl = global.fetch,
  apiKey = process.env.SAUTIKIT_API_KEY,
  apiBase = sautikitApiBase(),
} = {}) {
  const key = String(apiKey || '').trim();
  const id = String(outboundCallSid || '').trim();
  if (!key || !id) return { ok: false, reason: 'missing_hangup' };
  const res = await fetchImpl(`${apiBase}/v1/calls/${encodeURIComponent(id)}/hangup`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });
  return { ok: res.ok, status: res.status };
}

function resetConferenceTransfersForTests() {
  byCall.clear();
  byRoom.clear();
  byOutbound.clear();
}

module.exports = {
  FALLBACK_SAY,
  maskE164,
  conferenceRoomName,
  clientRequestIdFor,
  buildCallerConferenceDocument,
  buildAgentConferenceDocument,
  buildFallbackDocument,
  buildHangupDocument,
  buildOriginateBody,
  armConferenceTransfer,
  getConferenceTransfer,
  getConferenceTransferByRoom,
  parentCallForOutbound,
  conferenceKeepsCallOpen,
  isTerminalVoiceEdge,
  decideTransferContinue,
  decideAgentJoin,
  parseConferenceEvent,
  decideConferenceEvent,
  claimOriginate,
  releaseOriginate,
  bindOutboundLeg,
  markConferenceStatus,
  outboundLegResult,
  postOutboundTransfer,
  postConferenceCommand,
  hangupOutboundLeg,
  resetConferenceTransfersForTests,
};
