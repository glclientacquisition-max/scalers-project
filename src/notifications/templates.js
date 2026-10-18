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
    case 'caller_hold_ready': {
      const item = String(event.item || '').trim();
      const what = item ? `${item} is ready for pickup` : 'Your item is ready for pickup';
      return `${hi}${business} here. ${what}.`;
    }
    case 'caller_hold_cancelled': {
      const item = String(event.item || '').trim();
      const what = item ? `We cancelled the pickup for ${item}` : 'We cancelled your pickup';
      return `${hi}${business} here. ${what}.`;
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

function platformOpsDegradeBody(kind = 'speech', detail = {}) {
  const lane =
    kind === 'reasoning' || kind === 'llm'
      ? 'Reasoning'
      : kind === 'telephony'
        ? 'Phone line'
        : kind === 'audio'
          ? 'Phone audio'
          : 'Speech';
  const lines = [
    `Scalers platform ${lane} is degraded.`,
    'Check /admin Platform board and Voice GET /healthz.',
  ];
  const channel = String(detail.channel || '').trim();
  if (channel) lines.push(`Channel: ${channel}`);
  const message = String(detail.message || '').trim();
  if (message) lines.push(`Detail: ${message.slice(0, 160)}`);
  if (detail.balanceMinor != null && detail.currency) {
    const major = Number(detail.balanceMinor) / 100;
    lines.push(`Wallet: ${detail.currency} ${major}`);
  }
  return lines.join('\n');
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

// ---------------------------------------------------------------------------
// Staff call-alert SMS: one GSM-7 segment (160 chars).
// Owner/staff alerts for a call (lead, escalation, request, visit, voicemail,
// callback) go out as SMS in this short form. WhatsApp and email keep the
// full renderStaffText / escalationBody text. Basic GSM-7 only: one emoji,
// curly quote or en dash would switch the SMS to UCS-2 (70 chars).
// Callbacks only: never imply a live transfer or a confirmed booking.
// ---------------------------------------------------------------------------
const SMS_MAX = 160;
const STAFF_SMS_KINDS = new Set(['lead', 'escalation', 'service_request', 'appointment', 'voicemail', 'callback']);
const STAFF_SMS_LABELS = Object.freeze({
  lead: 'missed call',
  escalation: 'call back',
  service_request: 'request',
  appointment: 'visit request - to confirm',
  voicemail: 'voicemail',
  callback: 'callback request',
});
// Titles that serviceRequestTitle / appointmentTitle put in front of the reason.
const STAFF_SMS_TITLE_LABELS = Object.freeze({
  'ENQUIRY': 'enquiry',
  'HOLD / PICKUP': 'hold request',
  'ORDER': 'order request',
  'CALLBACK': 'callback request',
  'VISIT REQUEST': 'visit request - to confirm',
  'VISIT UPDATED': 'visit changed - to confirm',
  'VISIT CANCELLED': 'visit cancelled',
});
// Short call link code (calls.short_code): no 0/O/1/I/L.
const SHORT_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,8}$/;

// Basic GSM 03.38 characters that are also ASCII (extension chars [ ] { } ~ ^ | \ count double).
const GSM7_BASIC_RE = /^[A-Za-z0-9 \n\r!"#$%&'()*+,\-./:;<=>?@_]*$/;

function isGsm7Basic(text) {
  return GSM7_BASIC_RE.test(String(text == null ? '' : text));
}

/** Plain GSM-7 text: straight quotes, hyphens, no emoji, no extension chars. */
function toGsm7(text) {
  return String(text == null ? '' : text)
    .replace(/[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\t]/g, ' ')
    .replace(/[[{]/g, '(')
    .replace(/[\]}]/g, ')')
    .replace(/~/g, '-')
    .replace(/[\\|]/g, '/')
    .replace(/\u20ac/g, 'EUR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 \n!"#$%&'()*+,\-./:;<=>?@_]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function oneLine(text) {
  return toGsm7(String(text == null ? '' : text).replace(/\s*[\r\n]+\s*/g, ' '));
}

/** Cut to max chars with "...", on a word boundary when one is close. */
function clip(text, max) {
  const t = String(text || '');
  if (t.length <= max) return t;
  if (max <= 3) return t.slice(0, Math.max(0, max));
  let cut = t.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  if (space > 0 && space >= cut.length - 10) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:&/+-]+$/, '')}...`;
}

/** Kenyan mobile / landline-mobile as 07xx xxx xxx or 01xx xxx xxx; anything else as given. */
function smsPhone(raw) {
  const t = oneLine(raw);
  const digits = t.replace(/[\s()-]/g, '');
  const m = /^(?:\+?254|0)([17]\d{8})$/.exec(digits);
  if (m) {
    const n = `0${m[1]}`;
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  }
  return clip(t, 16);
}

/** host/c/<code>, or null when there is no valid short code (no link then). */
function shortCallLink(shortCode, deskBase) {
  const code = String(shortCode || '').trim();
  if (!SHORT_CODE_RE.test(code)) return null;
  const base = String(deskBase || 'app.scalers.co.ke').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!base || !isGsm7Basic(base) || /\s/.test(base)) return null;
  return `${base}/c/${code}`;
}

/**
 * One-segment SMS for a staff call alert, or null when kind is not one
 * (caller texts, billing notices, wallet / ops alerts keep their own text).
 *
 *   Mama Njeri Gas: missed call
 *   Wanjiku Kamau, 0712 345 678
 *   Wants 13kg gas refill to Kahawa West today, asked regulator price
 *   app.scalers.co.ke/c/K7P2QX
 *
 * Business 24 chars, name 20, number 16; the reason gets the rest (with
 * "..."). The short link is always kept when the call has a code.
 * @param {{ kind: string, lead?: { businessName?: string, name?: string, reason?: string, callerNumber?: string }, shortCode?: string|null, deskBase?: string|null }} opts
 */
function renderStaffSms({ kind, lead = {}, shortCode = null, deskBase = null } = {}) {
  const k = String(kind || '').trim();
  if (!STAFF_SMS_KINDS.has(k)) return null;
  let label = STAFF_SMS_LABELS[k];
  let detail = oneLine(lead && lead.reason);
  const m = /^([A-Z][A-Z /]+?):\s*/.exec(detail);
  if (m && STAFF_SMS_TITLE_LABELS[m[1].trim()]) {
    label = STAFF_SMS_TITLE_LABELS[m[1].trim()];
    detail = detail.slice(m[0].length).trim();
  }
  const biz = clip(oneLine(lead && lead.businessName), 24);
  const name = clip(oneLine(lead && lead.name) || 'Caller', 20);
  const phone = smsPhone(lead && lead.callerNumber);
  let link = shortCallLink(shortCode, deskBase);
  const lines = [biz ? `${biz}: ${label}` : label, phone ? `${name}, ${phone}` : name];
  if (link && lines.join('\n').length + link.length + 1 > SMS_MAX) link = null; // odd DESK_PUBLIC_URL
  const fixed = lines.join('\n').length + (link ? link.length + 1 : 0);
  const room = SMS_MAX - fixed - 1; // newline before the reason
  if (detail && room > 3) lines.push(clip(detail, room));
  if (link) lines.push(link);
  const out = lines.join('\n');
  return out.length <= SMS_MAX ? out : clip(out, SMS_MAX);
}

module.exports = {
  SHORT_CODE_RE,
  SMS_MAX,
  STAFF_SMS_KINDS,
  isGsm7Basic,
  renderStaffSms,
  shortCallLink,
  smsPhone,
  toGsm7,
  STAFF_ACTIONS,
  STAFF_TITLES,
  appointmentTitle,
  escalationBody,
  missedTextbackBody,
  platformOpsDegradeBody,
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
