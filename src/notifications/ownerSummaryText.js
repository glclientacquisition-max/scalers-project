'use strict';
// A4: the ONE owner message per call, rendered only from the typed
// `call.summary.ready` event (docs/explanation/brain/CALL_SUMMARY_EVENT.md).
// Pure. English + Swahili. ASCII only so an SMS stays GSM-7 (160 per segment).
//
// Render rules (Ops, 21 Oct):
// - Label comes from `outcome`. Only `missed` may say "Missed call".
// - Confirmed receipts render as the booking / order. Unconfirmed render as
//   "Interested in X, not confirmed" (never sold as confirmed).
// - Unconfirmed callback: "Asked for a callback, number/time not confirmed" + phone.
// - Missing slot: "not given". caller.phone null: "number not captured".
// - Stock only when in_stock / out_of_stock, else "stock to confirm".
// - Price as a range from unitPrice (single price when min = max).
// - The top-level `event` discriminator is ignored. catalogueId may be null.
// - brain_error / write_failed (B2, #1010): "Call back needed" label plus a
//   plain line saying whether the callback row was saved. Never "Enquiry".

const COPY = {
  en: {
    labels: {
      booked: 'Booking',
      ordered: 'Order',
      callback_needed: 'Callback needed',
      info_only: 'Enquiry',
      abandoned: 'Call ended early',
      missed: 'Missed call',
      escalated: 'URGENT',
      brain_error: 'Call back needed: the line had a problem',
      write_failed: 'Call back needed: request NOT saved',
    },
    caller: 'Caller',
    notGiven: 'not given',
    noNumber: 'number not captured',
    notConfirmed: 'not confirmed',
    interested: (x) => `Interested in ${x}, not confirmed`,
    qtyNotGiven: 'qty not given',
    priceToConfirm: 'price to confirm',
    each: 'each',
    per: (u) => `per ${u}`,
    inStock: 'in stock',
    outOfStock: 'out of stock',
    stockToConfirm: 'stock to confirm',
    when: 'When',
    place: 'Place',
    pickup: 'Pickup',
    reason: 'Reason',
    booking: 'Booking',
    order: 'Order',
    quote: 'Quote requested',
    quoteInterest: (x) => `Interested in a quote for ${x}, not confirmed`,
    callback: 'Callback',
    callbackUnconfirmed: 'Asked for a callback, number/time not confirmed',
    callOn: (p) => `Call ${p}`,
    complaint: 'Complaint',
    escalation: 'Manager requested',
    escalationUnconfirmed: 'Asked for a manager, not confirmed',
    noDetails: 'No details captured.',
    abandoned: 'Caller hung up before giving details.',
    infoOnly: 'Caller asked questions; nothing was booked or ordered.',
    open: 'Open call',
    fallbackMissed: (who) => `Missed call from ${who}`,
    fallbackAnswered: (who) => `Call from ${who}, no details captured`,
    // B2 (#1010) failure outcomes: always "call back", never an enquiry.
    failure: {
      brain_error: 'The line had a problem during this call. A callback request was saved. Please call the caller back.',
      write_failed: 'The assistant could not save this request. Please call the caller back.',
    },
  },
  sw: {
    labels: {
      booked: 'Miadi',
      ordered: 'Oda',
      callback_needed: 'Mpigie tena',
      info_only: 'Ulizo',
      abandoned: 'Simu ilikatika mapema',
      missed: 'Simu haikupokelewa',
      escalated: 'DHARURA',
      brain_error: 'Mpigie tena: laini ilikuwa na hitilafu',
      write_failed: 'Mpigie tena: ombi HALIKUHIFADHIWA',
    },
    caller: 'Mpigaji',
    notGiven: 'haijatolewa',
    noNumber: 'namba haikupatikana',
    notConfirmed: 'haijathibitishwa',
    interested: (x) => `Anavutiwa na ${x}, haijathibitishwa`,
    qtyNotGiven: 'idadi haijatolewa',
    priceToConfirm: 'bei ithibitishwe',
    each: 'kila moja',
    per: (u) => `kwa ${u}`,
    inStock: 'ipo',
    outOfStock: 'imeisha',
    stockToConfirm: 'stoki ithibitishwe',
    when: 'Lini',
    place: 'Mahali',
    pickup: 'Kuchukua',
    reason: 'Sababu',
    booking: 'Miadi',
    order: 'Oda',
    quote: 'Anaomba bei',
    quoteInterest: (x) => `Anataka bei ya ${x}, haijathibitishwa`,
    callback: 'Mpigie',
    callbackUnconfirmed: 'Ameomba apigiwe, namba/saa hazijathibitishwa',
    callOn: (p) => `Piga ${p}`,
    complaint: 'Malalamiko',
    escalation: 'Anaomba meneja',
    escalationUnconfirmed: 'Ameomba meneja, haijathibitishwa',
    noDetails: 'Hakuna maelezo yaliyopatikana.',
    abandoned: 'Mpigaji alikata kabla ya kutoa maelezo.',
    infoOnly: 'Mpigaji aliuliza maswali; hakuna miadi wala oda.',
    open: 'Fungua simu',
    fallbackMissed: (who) => `Simu ambayo haikupokelewa kutoka ${who}`,
    fallbackAnswered: (who) => `Simu kutoka ${who}, hakuna maelezo yaliyopatikana`,
    failure: {
      brain_error: 'Laini ilikuwa na hitilafu wakati wa simu hii. Ombi la kupigiwa limehifadhiwa. Tafadhali mpigie mpigaji.',
      write_failed: 'Msaidizi hakuweza kuhifadhi ombi hili. Tafadhali mpigie mpigaji.',
    },
  },
};

function lang(value) {
  return value === 'sw' ? 'sw' : 'en';
}

/** ASCII-fold so the SMS stays GSM-7 (a stray degree sign or dash is 3x cost). */
function ascii(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00b0/g, ' deg')
    .replace(/[^\x20-\x7e\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function slotText(slots, key, c) {
  const s = slots && slots[key];
  if (s && s.status === 'given' && s.value != null && s.value !== '') return ascii(s.value);
  return c.notGiven;
}

function given(slots, key) {
  const s = slots && slots[key];
  return Boolean(s && s.status === 'given' && s.value != null && s.value !== '');
}

function money(n) {
  return Math.round(Number(n)).toLocaleString('en-US');
}

function priceText(unitPrice, c) {
  if (!unitPrice || !Number.isFinite(Number(unitPrice.min))) return c.priceToConfirm;
  const min = Number(unitPrice.min);
  const max = Number.isFinite(Number(unitPrice.max)) ? Number(unitPrice.max) : min;
  const amount = max > min ? `KSh ${money(min)}-${money(max)}` : `KSh ${money(min)}`;
  const unit = ascii(unitPrice.unit || 'each').toLowerCase();
  return `${amount} ${unit === 'each' || !unit ? c.each : c.per(unit)}`;
}

function stockText(stock, c) {
  if (stock === 'in_stock') return c.inStock;
  if (stock === 'out_of_stock') return c.outOfStock;
  return c.stockToConfirm;
}

function itemText(item, c) {
  const name = ascii(item?.name) || c.notGiven;
  const q = item?.qty;
  const head = q && q.status === 'given' && q.value != null ? `${ascii(q.value)} x ${name}` : `${name} (${c.qtyNotGiven})`;
  return `${head} (${priceText(item?.unitPrice, c)}, ${stockText(item?.stock, c)})`;
}

function itemsText(items, c) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return list.map((it) => itemText(it, c)).join('; ');
}

function receiptLines(r, c, { callerPhone } = {}) {
  const slots = r.slots || {};
  const confirmed = r.status === 'confirmed';
  switch (r.type) {
    case 'booking': {
      const service = slotText(slots, 'service', c);
      const tail = `${c.when}: ${slotText(slots, 'when', c)}. ${c.place}: ${slotText(slots, 'place', c)}.`;
      return confirmed ? [`${c.booking}: ${service}. ${tail}`] : [`${c.interested(service)}. ${tail}`];
    }
    case 'order': {
      const items = itemsText(r.items, c) || c.notGiven;
      const tail = `${c.pickup}: ${slotText(slots, 'pickup', c)}.`;
      return confirmed ? [`${c.order}: ${items}. ${tail}`] : [`${c.interested(items)}. ${tail}`];
    }
    case 'quote': {
      const what = itemsText(r.items, c) || slotText(slots, 'reason', c);
      return confirmed ? [`${c.quote}: ${what}.`] : [`${c.quoteInterest(what)}.`];
    }
    case 'callback': {
      const reason = `${c.reason}: ${slotText(slots, 'reason', c)}.`;
      if (confirmed) return [`${c.callback}: ${c.callOn(callerPhone || c.noNumber)}. ${reason}`];
      return [`${c.callbackUnconfirmed}. ${callerPhone || c.noNumber}. ${reason}`];
    }
    case 'complaint':
      return [`${c.complaint}${confirmed ? '' : ` (${c.notConfirmed})`}: ${slotText(slots, 'reason', c)}.`];
    case 'escalation':
      return [`${confirmed ? c.escalation : c.escalationUnconfirmed}: ${slotText(slots, 'reason', c)}.`];
    default:
      return [];
  }
}

function callerName(event) {
  const name = ascii(event?.caller?.name);
  if (name) return name;
  for (const r of Array.isArray(event?.receipts) ? event.receipts : []) {
    if (given(r.slots, 'name')) return ascii(r.slots.name.value);
  }
  return '';
}

function callerPhone(event) {
  const phone = event?.caller?.phone;
  return typeof phone === 'string' && /^\+\d{6,15}$/.test(phone) ? phone : null;
}

/** "Name, +2547..." / "+2547..." / "Name, number not captured" / "number not captured". */
function callerLine(event, c) {
  const name = callerName(event);
  const phone = callerPhone(event) || c.noNumber;
  return name ? `${name}, ${phone}` : phone;
}

/**
 * Render the owner summary for one `call.summary.ready` event.
 * @returns {{ text: string, subject: string, label: string, language: 'en'|'sw' }}
 */
function renderOwnerSummary(event, { businessName, callUrl } = {}) {
  const language = lang(event?.callLanguage);
  const c = COPY[language];
  const outcome = c.labels[event?.outcome] ? event.outcome : 'info_only';
  let label = c.labels[outcome];
  if (outcome === 'escalated' && event?.escalationReason) {
    label = `${label}: ${ascii(event.escalationReason)}`;
  }
  const biz = ascii(businessName);
  const lines = [`${label}${biz ? ` - ${biz}` : ''}`, `${c.caller}: ${callerLine(event, c)}`];
  const failureNote = c.failure[outcome] || null;
  if (failureNote) lines.push(failureNote);
  const receipts = Array.isArray(event?.receipts) ? event.receipts : [];
  // Urgent first, then confirmed, then the rest, so the headline is the action.
  const order = { escalation: 0, booking: 1, order: 1, callback: 2, complaint: 2, quote: 3 };
  const sorted = receipts
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      (order[a.r.type] ?? 9) - (order[b.r.type] ?? 9) ||
      (a.r.status === 'confirmed' ? 0 : 1) - (b.r.status === 'confirmed' ? 0 : 1) ||
      a.i - b.i
    )
    .map((x) => x.r);
  const phone = callerPhone(event);
  for (const r of sorted) lines.push(...receiptLines(r, c, { callerPhone: phone }));
  if (!receipts.length) {
    if (outcome === 'abandoned') lines.push(c.abandoned);
    else if (outcome === 'missed') lines.push(c.noDetails);
    else if (!failureNote) lines.push(c.infoOnly);
  }
  if (callUrl) lines.push(`${c.open}: ${callUrl}`);
  const text = lines.map(ascii).filter(Boolean).join('\n').slice(0, 1600);
  return { text, subject: `${c.labels[outcome]}${biz ? ` - ${biz}` : ''}`, label: c.labels[outcome], language };
}

/**
 * Fallback when no event arrived 2 min after the call ended.
 * missed (never answered): "Missed call from X"; answered: "Call from X, no details captured".
 */
function renderFallback({ answered, callerName: name, callerPhone: phone, businessName, callUrl, language } = {}) {
  const l = lang(language);
  const c = COPY[l];
  const who = ascii(name) ? `${ascii(name)} (${phone || c.noNumber})` : phone || c.noNumber;
  const head = answered ? c.fallbackAnswered(who) : c.fallbackMissed(who);
  const biz = ascii(businessName);
  const lines = [`${head}${biz ? ` - ${biz}` : ''}`];
  if (callUrl) lines.push(`${c.open}: ${callUrl}`);
  const text = lines.map(ascii).join('\n');
  const label = answered ? c.labels.info_only : c.labels.missed;
  return { text, subject: `${answered ? c.fallbackAnswered(who) : c.fallbackMissed(who)}`, label, language: l };
}

module.exports = {
  COPY,
  ascii,
  priceText,
  stockText,
  itemText,
  renderOwnerSummary,
  renderFallback,
};
