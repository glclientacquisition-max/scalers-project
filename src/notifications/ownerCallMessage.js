// One owner message per call, sent when the call ends.
//
// Mid-call tools (book / update a visit, take a hold or enquiry, save the
// caller's name) used to text the owner straight away, then hangup sent a
// lead too. Each inbox recipient got two or three messages per call, and an
// answered call was titled "New missed-call lead".
//
// Now tools only note what changed. At call end we build one message:
// visits first, then requests, else a lead. The ledger key follows the
// handoff spec (#632): handoff:<call_id>:summary:<channel>:<recipient>.
// notify_sends has a unique (tenant_id, idempotency_key) index, so a second
// sender for the same call, channel and recipient is refused by the DB.
// Escalations stay immediate and are not routed through here.

const {
  appointmentEvent,
  displayOwnerCallerName,
  ownerLeadEvent,
  renderEventSubject,
  renderEventText,
  serviceRequestEvent,
  shouldSendOwnerLead,
} = require('./events');

const ANSWERED_LEAD_TITLE = 'New call lead';
const MISSED_LEAD_TITLE = 'New missed-call lead';

/** VOICE_OWNER_MESSAGE_AT_END=off restores the old mid-call sends. */
function ownerMessageAtEndEnabled(env = process.env) {
  const raw = String(env.VOICE_OWNER_MESSAGE_AT_END ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/** Ledger key base. Channel and recipient are appended per send. */
function ownerSummaryKeyBase(callId, callSid) {
  const id = String(callId || callSid || '').trim();
  return id ? `handoff:${id}:summary` : null;
}

// callSid -> Map(entityKey -> { type, kind, row, at })
// Cleared when the message goes. Capped so a call that never closes cannot leak.
const pending = new Map();
const PENDING_CAP = 500;

function entityKey(type, row = {}) {
  const id = row.id || row.appointment_id || row.request_id;
  return `${type}:${id || `${row.service_name || row.item || ''}:${row.when_text || ''}`}`;
}

/**
 * Note a visit or request the call created or changed. Latest state wins per
 * entity; a visit created then updated in the same call stays "created".
 */
function noteOwnerCallItem(callSid, { type, kind = 'created', row } = {}) {
  if (!callSid || !row || (type !== 'visit' && type !== 'request')) return;
  let items = pending.get(callSid);
  if (!items) {
    items = new Map();
    pending.set(callSid, items);
    if (pending.size > PENDING_CAP) pending.delete(pending.keys().next().value);
  }
  const key = entityKey(type, row);
  const prior = items.get(key);
  items.set(key, {
    type,
    kind: prior?.kind === 'created' ? 'created' : kind,
    row,
    at: prior?.at || Date.now(),
  });
}

function pendingOwnerCallItems(callSid) {
  const items = pending.get(callSid);
  return items ? [...items.values()] : [];
}

function clearOwnerCallItems(callSid) {
  pending.delete(callSid);
}

/** DB rows tied to this call that the memory map may not hold (restart). */
function mergeOwnerCallItems(dbItems = [], memoryItems = []) {
  const out = new Map();
  for (const item of dbItems) {
    if (item?.row) out.set(entityKey(item.type, item.row), item);
  }
  for (const item of memoryItems) {
    if (item?.row) out.set(entityKey(item.type, item.row), item);
  }
  return [...out.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
}

/**
 * Answered = the line picked up and spoke to the caller. A call with agent
 * turns, or a first-forward record that says the greeting played.
 */
function callWasAnswered(call = {}, { answered, agentTurns } = {}) {
  if (typeof answered === 'boolean') return answered;
  if (Number(agentTurns) > 0) return true;
  let meta = null;
  if (call.summary && typeof call.summary === 'object') meta = call.summary;
  else if (typeof call.summary === 'string') {
    try {
      meta = JSON.parse(call.summary);
    } catch {
      meta = null;
    }
  }
  const ff = call.first_forward || meta?.first_forward || null;
  if (ff && (ff.greeting_played === true || ff.answered === true)) return true;
  return false;
}

function withCallerName(row = {}, call = {}) {
  const name = displayOwnerCallerName(row.caller_name) || displayOwnerCallerName(call.name) || null;
  return { ...row, caller_name: name };
}

function itemEvent(item, call, businessName) {
  const row = withCallerName(item.row, call);
  if (item.type === 'visit') return appointmentEvent(row, businessName, item.kind);
  return serviceRequestEvent(row, businessName);
}

/**
 * Build the one owner message for a finished call, or null if there is
 * nothing to say. Visits outrank requests, which outrank a plain lead.
 */
function buildOwnerCallMessage({ call = {}, items = [], businessName, answered, callUrl } = {}) {
  const visits = items.filter((i) => i.type === 'visit');
  const requests = items.filter((i) => i.type === 'request');
  const ordered = [...visits, ...requests];
  const isAnswered = callWasAnswered(call, { answered });

  if (ordered.length) {
    const events = ordered.map((item) => itemEvent(item, call, businessName));
    const primary = events[0];
    const sections = events.map((event, idx) => {
      const ev = idx === 0 ? { ...event, callUrl: null } : { ...event, businessName: null, callUrl: null };
      return renderEventText(ev);
    });
    if (callUrl) sections[sections.length - 1] += `\nOpen call: ${callUrl}`;
    const body = sections.join('\n\n');
    const kind = visits.length ? 'appointment' : 'service_request';
    const first = ordered[0].row || {};
    const callerName = displayOwnerCallerName(first.caller_name) || displayOwnerCallerName(call.name);
    return {
      kind,
      title: primary.title || null,
      subject: renderEventSubject(primary),
      body,
      answered: isAnswered,
      lead: {
        businessName,
        name: callerName || 'Caller',
        reason: `${primary.title}: ${[first.service_name || first.item, first.when_text]
          .filter(Boolean)
          .join('. ')}`,
        callerNumber: first.caller_phone || call.from_number,
      },
    };
  }

  if (!shouldSendOwnerLead(call)) return null;
  const event = {
    ...ownerLeadEvent({ ...call, callUrl }, businessName),
    title: isAnswered ? ANSWERED_LEAD_TITLE : MISSED_LEAD_TITLE,
  };
  return {
    kind: 'lead',
    title: event.title,
    subject: renderEventSubject(event),
    body: renderEventText(event),
    answered: isAnswered,
    lead: {
      businessName,
      name: event.caller?.name || call.name,
      reason: event.caller?.reason || call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    },
  };
}

/** owner_notified (new) or whatsapp_sent (old rows) on the call summary. */
function ownerNotifiedMeta(call = {}) {
  if (call.owner_notified || call.whatsapp_sent) return true;
  try {
    const meta = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
    return Boolean(meta && (meta.owner_notified || meta.whatsapp_sent));
  } catch {
    return false;
  }
}

/** Per-channel result: sent if any recipient got it, else failed if tried. */
function ownerNotifyChannels(sent = [], errors = []) {
  const channels = {};
  for (const r of sent) {
    for (const e of Array.isArray(r?.errors) ? r.errors : []) {
      const m = /(?:^|:)(sms|whatsapp|email):/.exec(String(e));
      if (m) channels[m[1]] = channels[m[1]] || 'failed';
    }
  }
  for (const e of errors || []) {
    const m = /(?:^|:)(sms|whatsapp|email):/.exec(String(e));
    if (m) channels[m[1]] = channels[m[1]] || 'failed';
  }
  for (const r of sent) if (r?.channel) channels[r.channel] = 'sent';
  return channels;
}

module.exports = {
  ANSWERED_LEAD_TITLE,
  MISSED_LEAD_TITLE,
  buildOwnerCallMessage,
  callWasAnswered,
  clearOwnerCallItems,
  mergeOwnerCallItems,
  noteOwnerCallItem,
  ownerMessageAtEndEnabled,
  ownerNotifiedMeta,
  ownerNotifyChannels,
  ownerSummaryKeyBase,
  pendingOwnerCallItems,
};
