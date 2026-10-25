// Phone alert (web push) payload formatter. Brain/Voice call this, then pass the result to
// sendPush() in ./push.js. Pure: no env, no I/O. See docs/reference/platform/DESK_PWA_PUSH.md.
//
//   formatMissedCallPush({ callId, callerName, callerNumber, at, reason, lang })
//   formatBookingPush({ bookingId, service, startsAt, callerName, callerNumber, at, lang })
//
// Returns { title, body, url, tag, icon, badge, timestamp, renotify: false }.
// Body is at most BODY_MAX chars, cut on a whole word; vendor names are scrubbed.
// lang 'sw' (tenant language) picks the Kiswahili strings; anything else is English.

const BODY_MAX = 110;
const TZ = 'Africa/Nairobi';
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';
const SEP = ' · ';

const STRINGS = {
  en: { missed: 'Missed call', booking: 'New booking', unknown: 'Unknown caller', locale: 'en-GB' },
  sw: { missed: 'Simu uliyokosa', booking: 'Miadi mpya', unknown: 'Mpigaji asiyejulikana', locale: 'sw-KE' },
};

// Provider names never reach the owner's lock screen.
const VENDOR_RE =
  /\b(twilio|africa'?s ?talking|vapi|openai|gpt[-\w]*|deepgram|elevenlabs|soniox|cartesia|gemini|anthropic|claude|groq|resend|supabase|vercel|railway|meta|whatsapp cloud api)\b/gi;

function pickLang(lang) {
  return String(lang || '').toLowerCase().startsWith('sw') ? 'sw' : 'en';
}

/** +254712345678 / 0712345678 / 254712345678 -> "+254 712 345 678". Other numbers pass through trimmed. */
function formatKenyanNumber(raw) {
  const s = String(raw || '').trim();
  const d = s.replace(/[^\d]/g, '');
  let local = null;
  if (/^254[17]\d{8}$/.test(d)) local = d.slice(3);
  else if (/^0[17]\d{8}$/.test(d)) local = d.slice(1);
  if (!local) return s;
  return `+254 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

function toDate(v) {
  const d = v instanceof Date ? v : new Date(v == null ? Date.now() : v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function timeEat(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function dayTimeEat(d, lang) {
  const day = new Intl.DateTimeFormat(STRINGS[lang].locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${day.replace(/,/g, '')} ${timeEat(d)}`;
}

function scrub(text) {
  return String(text || '').replace(VENDOR_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/** Cut to max chars on a whole word, adding an ellipsis when cut. */
function clampWords(text, max = BODY_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1);
  const cut = room.lastIndexOf(' ');
  return `${(cut > max * 0.5 ? room.slice(0, cut) : room).replace(/[\s·,.;:-]+$/, '')}…`;
}

function who(name, number, lang) {
  const n = scrub(name);
  if (n) return n;
  const num = formatKenyanNumber(number);
  return num || STRINGS[lang].unknown;
}

function safeId(id) {
  return encodeURIComponent(String(id || '').slice(0, 64));
}

function formatMissedCallPush({ callId, callerName, callerNumber, at, reason, lang } = {}) {
  const L = pickLang(lang);
  const d = toDate(at);
  const parts = [who(callerName, callerNumber, L), `${timeEat(d)} EAT`];
  const r = scrub(reason);
  if (r) parts.push(r);
  return {
    title: STRINGS[L].missed,
    body: clampWords(parts.join(SEP)),
    url: callId ? `/calls/${safeId(callId)}` : '/calls',
    tag: callId ? `call-${String(callId).slice(0, 59)}` : undefined,
    icon: ICON,
    badge: BADGE,
    timestamp: d.getTime(),
    renotify: false,
  };
}

function formatBookingPush({ bookingId, service, startsAt, callerName, callerNumber, at, lang } = {}) {
  const L = pickLang(lang);
  const parts = [];
  const svc = scrub(service);
  if (svc) parts.push(svc);
  if (startsAt != null) parts.push(`${dayTimeEat(toDate(startsAt), L)} EAT`);
  parts.push(who(callerName, callerNumber, L));
  return {
    title: STRINGS[L].booking,
    body: clampWords(parts.join(SEP)),
    url: bookingId ? `/bookings/${safeId(bookingId)}` : '/bookings',
    tag: bookingId ? `booking-${String(bookingId).slice(0, 56)}` : undefined,
    icon: ICON,
    badge: BADGE,
    timestamp: toDate(at).getTime(),
    renotify: false,
  };
}

module.exports = {
  BODY_MAX,
  clampWords,
  formatBookingPush,
  formatKenyanNumber,
  formatMissedCallPush,
  scrub,
};
