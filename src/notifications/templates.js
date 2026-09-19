// Scalers-owned message catalog. Staff and caller SMS copy lives here.
// Owners do not edit these. Desk caller SMS must match this wording.
// No em dashes or en dashes. No Want/Done/Mood card on staff SMS.

const STAFF_TITLES = Object.freeze({
  lead: 'New missed-call lead',
  escalation: 'Escalation',
  service_request: 'Request',
  appointment: 'Visit request',
  wallet_low: 'Scalers wallet running low',
  wallet_empty: 'Scalers prepaid empty',
  outage_speech: 'Scalers line downtime',
  outage_llm: 'Scalers line taking names only',
});

const STAFF_ACTIONS = Object.freeze({
  service_request: 'Open Inbox Holds to mark fulfilled.',
  appointment: 'Open Inbox Visits to confirm or cancel.',
});

function titled(title, businessName) {
  const head = String(title || '').trim() || 'Scalers alert';
  const biz = String(businessName || '').trim();
  return biz ? `${head}. ${biz}` : head;
}

function staffTitle(kind, override) {
  if (override && String(override).trim()) return String(override).trim();
  return STAFF_TITLES[kind] || 'Scalers alert';
}

function staffAction(kind) {
  return STAFF_ACTIONS[kind] || null;
}

function serviceRequestTitle(type) {
  const t = String(type || 'enquiry').toLowerCase();
  if (t === 'hold') return 'HOLD / PICKUP';
  if (t === 'order') return 'ORDER';
  if (t === 'callback') return 'CALLBACK';
  return 'ENQUIRY';
}

function appointmentTitle(kind, status) {
  const k = String(kind || 'created').toLowerCase();
  const s = String(status || 'requested').toLowerCase();
  if (k === 'updated' && s === 'cancelled') return 'VISIT CANCELLED';
  if (k === 'updated') return 'VISIT UPDATED';
  return 'VISIT REQUEST';
}

function line(label, value) {
  if (value == null || String(value).trim() === '') return null;
  return `${label}: ${String(value).trim()}`;
}

function renderStaffText(event = {}) {
  const title = staffTitle(event.kind, event.title);
  const lines = [titled(title, event.businessName)];
  for (const [label, value] of event.fields || []) {
    const row = line(label, value);
    if (row) lines.push(row);
  }
  if (event.recordingUrl) lines.push(`Recording: ${event.recordingUrl}`);
  if (event.callUrl) lines.push(`Open call: ${event.callUrl}`);
  if (event.action) lines.push(event.action);
  return lines.filter(Boolean).join('\n');
}

function renderStaffSubject(event = {}) {
  return titled(staffTitle(event.kind, event.title), event.businessName);
}

function callerHi(name) {
  const who = String(name || '').trim();
  return who ? `Hi ${who}, ` : 'Hi, ';
}

function visitWhat(item) {
  const service = String(item || '').trim();
  return service ? `your ${service} visit` : 'your visit';
}

function forWhen(when) {
  const slot = String(when || '').trim();
  return slot ? ` for ${slot}` : '';
}

function toWhen(when) {
  const slot = String(when || '').trim();
  return slot ? ` to ${slot}` : '';
}

function renderCallerText(event = {}) {
  const business = String(event.businessName || '').trim() || 'We';
  const hi = callerHi(event.caller?.name);
  const kind = event.kind;
  switch (kind) {
    case 'caller_appointment': {
      const what = visitWhat(event.item);
      return `${hi}${business} here. We have ${what}${forWhen(event.when)}. We will confirm shortly.`;
    }
    case 'caller_appointment_confirmed': {
      const service = String(event.item || '').trim();
      const what = service ? `${service} visit` : 'visit';
      return `${hi}${business} here. Your ${what}${forWhen(event.when)} is confirmed.`;
    }
    case 'caller_appointment_cancelled': {
      return `${hi}${business} here. We cancelled ${visitWhat(event.item)}${forWhen(event.when)}.`;
    }
    case 'caller_appointment_rescheduled': {
      return `${hi}${business} here. We moved ${visitWhat(event.item)}${toWhen(event.when)}.`;
    }
    case 'caller_hold': {
      const item = String(event.item || '').trim();
      const what = item ? `We have held ${item} for you` : 'We have held your item';
      return `${hi}${business} here. ${what}. We will confirm shortly.`;
    }
    case 'caller_hold_updated': {
      const item = String(event.item || '').trim();
      const when = String(event.when || '').trim();
      const what = item ? `Pickup for ${item}` : 'Pickup';
      const now = when ? ` is now ${when}` : ' was updated';
      return `${hi}${business} here. ${what}${now}.`;
    }
    case 'caller_order': {
      const item = String(event.item || '').trim();
      const what = item ? `your order for ${item}` : 'your order';
      return `${hi}${business} here. We have ${what}. We will confirm shortly.`;
    }
    case 'caller_callback':
      return `${hi}${business} here. The team will call you back.`;
    default:
      return `${hi}${business} here. We have your request. We will confirm shortly.`;
  }
}

function missedTextbackBody(businessName) {
  const business = String(businessName || '').trim();
  const who = business ? `${business} here` : 'the business you called';
  return `Hi, ${who}. Sorry we missed your call. We will call you back.`;
}

function walletLowBody({ businessName, balanceKes, lowThresholdKes } = {}) {
  const bal = Number(balanceKes || 0).toLocaleString('en-KE');
  const thr = Number(lowThresholdKes || 200).toLocaleString('en-KE');
  return [
    titled('Scalers wallet running low', businessName),
    `Prepaid balance is about KES ${bal} (alert under KES ${thr}). Top up soon so calls stay covered.`,
  ].join('\n');
}

function walletEmptyBody({ businessName, onDemandEnabled } = {}) {
  const head = titled('Scalers prepaid empty', businessName);
  const detail = onDemandEnabled
    ? 'Prepaid balance is KES 0. On-demand is on. Top up when you can.'
    : 'Prepaid balance is KES 0. On-demand is off. Top up or enable on-demand on Wallet.';
  return [head, detail].join('\n');
}

function outageBody(businessName, kind = 'speech') {
  const who = String(businessName || '').trim();
  if (kind === 'llm') {
    if (who) {
      return `${who} line is taking names only. Callers are asked for a name so the team can call back.`;
    }
    return 'Your Scalers line is taking names only. Callers are asked for a name so the team can call back.';
  }
  if (who) {
    return `${who} line downtime. Callers heard a short message and were asked to call back.`;
  }
  return 'Your Scalers line is on downtime. Callers heard a short message and were asked to call back.';
}

function teammateWho(teammate) {
  if (!teammate) return 'the team';
  const role = teammate.role ? ` (${teammate.role})` : '';
  return `${teammate.name}${role}`;
}

function escalationBody({
  businessName,
  teammate,
  callerName,
  reason,
  callerNumber,
  recordingUrl,
  requested,
  match,
} = {}) {
  const who = teammateWho(teammate);
  const isFallback = match === 'fallback' && requested;
  const title = `Escalation for ${who}`;
  const head = isFallback
    ? `${titled(title, businessName)} (fallback)`
    : titled(title, businessName);
  const lines = [
    head,
    '',
    `Caller: ${callerName || 'Caller'}`,
    `Phone: ${callerNumber || 'Unknown'}`,
    `Reason: ${reason || 'None'}`,
  ];
  if (isFallback) {
    lines.push(`Caller asked for: ${requested}`);
    lines.push(`No exact match. Routed to ${who}.`);
  } else if (requested && match && match !== 'exact_name') {
    lines.push(`Matched on: ${requested}`);
  }
  if (teammate?.phone) {
    lines.push(`Teammate phone: ${teammate.phone}`);
  }
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

module.exports = {
  STAFF_ACTIONS,
  STAFF_TITLES,
  appointmentTitle,
  escalationBody,
  missedTextbackBody,
  outageBody,
  renderCallerText,
  renderStaffSubject,
  renderStaffText,
  serviceRequestTitle,
  staffAction,
  staffTitle,
  titled,
  walletEmptyBody,
  walletLowBody,
};
