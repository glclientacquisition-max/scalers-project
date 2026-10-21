'use strict';
// BA v2 dialogue state machine. One machine per intent:
//   collect -> readback -> (caller yes) -> commit -> done | handoff
// Slots are held server-side across turns and merged into tool args (HD_212 fix by
// construction). Commits need a confirm_token minted on the read-back turn and
// redeemed only on the caller's yes. Speech comes only from receipts.js.
const L = require('./lexicon');
const N = require('./nlu');
const R = require('./receipts');
const { buildCatalogue, validateCall } = require('./catalogue');
const { listedAreaIds, listedAreaRows } = require('../listedAreas');
const { compileSpokenCatalogue, joinList } = require('../spokenCatalogue');
const { compileSpokenCoverage, compileSpokenPolicies } = require('../spokenFacts');
const { compileAskReceipt } = require('./askReceipt');
const { applyTicket, needsClassify, normalizeTicket } = require('./classifyAsk');
const { renderOwnerMessage } = require('./owner');
const { buildRequest } = require('./gemini');
// BRAIN_V2_COMMIT_SAFETY (default off): two-phase commit, validators, idempotency, write receipts, outbox (plan row C1).
const CS = require('./commitSafety');
const csOn = () => CS.commitSafetyEnabled();
// VOICE_V2_CATALOGUE: catalogue words, categories, explanations and prices come from the
// tenant's spoken catalogue (src/knowledge/spokenCatalogue.js). Off: unchanged behaviour.
const SC = require('../../knowledge/spokenCatalogue');
const scOn = () => /^(1|true|on|yes)$/i.test(String(process.env.VOICE_V2_CATALOGUE || ''));
function spoken(profile, svc, lang) {
  if (!scOn() || !svc) return null;
  const sc = SC.resolveSpokenCatalogue(profile); const e = SC.entryForRaw(sc, svc.name); const Lg = L.isSw(lang) ? 'sw' : 'en';
  return { label: SC.sayName(sc, svc.name, Lg) || svc.name, price: e ? e.price[Lg] : null, explain: e?.explain?.[Lg] || null, sc };
}

// §4 service check answer: catalogue label + grounded price (spoken catalogue when on, else items[] price_range).
function checkServiceLine(profile, svc, lang) {
  const sp = spoken(profile, svc, lang);
  return R.info({ kind: 'offered', label: sp ? sp.label : svc.name, price: sp ? sp.price : (svc.pricing?.confirmed === false ? null : svc.price_range || null) }, lang);
}
const TRANSACTIONAL = ['payment_change', 'address_change', 'cancel', 'change', 'complaint', 'handoff', 'order', 'book'];
const INFO = ['payment_how', 'policy_returns', 'policy_deposit', 'policy_warranty', 'policy_cancel', 'greeting', 'who_are_you', 'services', 'coverage', 'recall', 'availability', 'price', 'hours', 'want_know'];
const AREA_ASK = /\b(nafika|niko|nipo|mnafika|mnakuja|mtafika|mnafikana|cover|do you cover|travel fee|delivery fee|fee to|fare|ada ya|usafiri|do you deliver|do you come)\b|\bfair\b.{0,24}\b(kuja|come|to)\b/i;
const POLICY_KEY = { policy_returns: 'returns', policy_deposit: 'deposit', policy_warranty: 'warranty', policy_cancel: 'cancellation' };
const FEE_ASK = /\b(travel fee|delivery fee|fee to|fare|ada ya|usafiri|transport|how much|ngapi|bei)\b|\bfair\b.{0,24}\b(kuja|come|to)\b/i;
const DELIVER_ASK = /\b(deliver|delivery|mnafika|come to|do you come)\b/i;

function createState({ profile = {}, callerPhone, contactName = null, openRows = [], pendingTasks = [], callId = null } = {}) {
  return {
    v: 2, callId, turn: 0, lang: null, intent: null, phase: 'collect', expecting: null,
    slots: { service: null, when: { date: null, time: null }, place: null, name: null, items: [], row: null, new_when: { date: null, time: null }, new_place: null, kind: null, topic: null, complaint: [] },
    asked: {}, pending: null, tokenSeq: 0, lastLine: '', lastInfo: null, infoRepeat: {}, unknownCount: 0,
    callerPhone, file: { contactName, openRows: openRows.map(normRow), pendingTasks },
    staffNames: (profile.staffNames || []).map((s) => String(s).toLowerCase()),
    outcomes: [], receipts: [], callbacks: [], trace: [], ended: false,
  };
}
function normRow(r) {
  const iso = r.window_start;
  let when = { date: null, time: null };
  if (iso) { const p = L.eatParts(new Date(iso)); when = { date: L.isoDate(p), time: `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}` }; }
  return { id: r.id, kind: r.kind === 'request' ? 'request' : 'visit', type: r.type || null, service: r.service_name, when, whenText: String(r.when_text || '').trim() || null, place: r.address_landmark, status: r.status };
}

const nameSpeakable = (state) => state.slots.name && !state.staffNames.includes(state.slots.name.toLowerCase()) ? state.slots.name : null;
const vertical = (p) => (String(p.vertical || '').includes('retail') || (!p.servicesCatalog?.length && p.productCatalog?.length) ? 'retail' : 'home');

function pickIntent(u, state, profile) {
  let t = u.intents.find((i) => TRANSACTIONAL.includes(i));
  if (t === 'book' && vertical(profile) === 'retail') t = 'order';
  if (t === 'order' && vertical(profile) === 'home') t = 'book';
  if (t === 'handoff' && state.intent === 'complaint') t = null;
  // a question about services/prices/hours/areas that only mentions "usafi" is an enquiry, not a booking
  if (t === 'book' && u.intents.some((i) => ['services', 'coverage', 'price', 'hours'].includes(i)) && !/\b(book|ku-?book|kubook|appointment|schedule|tuweke|tuieke)\b/i.test(u.text)) t = null;
  if (t === 'cancel' && u.intents.includes('policy_cancel')) t = null;
  return t || null;
}

const s0 = (state) => state.slots;
function mergeSlots(state, u, profile) {
  // BRAIN_V2_COMMIT_SAFETY: a bare yes/no word is never a place ("Tuje wapi?" -> "Ndio")
  if (csOn() && u.place && /^\W*(ndio|ndiyo|yes|yeah|sawa|ok|okay|hapana|no|haya|poa)\W*$/i.test(String(u.place))) u.place = null;
  // a phone number or a whole sentence is not a place; a place word given when we asked the name keeps the place we have
  if (csOn() && u.place && (/\d{3,}/.test(String(u.place)) || String(u.place).split(/\s+/).length > 4)) u.place = null;
  if (csOn() && u.place && state.expecting === 'name' && s0(state).place && !u.name) u.place = null;
  if (u.name || u.place || u.service || u.when?.date || u.when?.time || u.products?.length) state.progressTurn = state.turn;
  const s = state.slots;
  if (u.name) {
    s.name = u.name; s.nameConfirmed = true;
    if (u.correctionOf) s.nameCorrectionOf = u.correctionOf;
  }
  if (state.intent === 'change' && /\b(to|hadi|iwe)\b/i.test(u.text)) {
    const after = u.text.split(/\b(?:to|hadi|iwe)\b/i).slice(1).join(' to ');
    const before = u.text.split(/\b(?:to|hadi|iwe)\b/i)[0];
    const nw = L.parseWhen(after, state.now);
    if (nw) { s.new_when = { date: nw.date || s.new_when.date, time: nw.time || s.new_when.time }; u.rowHint = before; }
  } else if (state.intent === 'change' && s.row && u.when) {
    s.new_when = { date: u.when.date || s.new_when.date, time: u.when.time || s.new_when.time };
  } else if (u.when && !['cancel', 'change', 'address_change'].includes(state.intent)) {
    if (u.when.date) s.when.date = u.when.date;
    if (u.when.time) { s.when.time = u.when.time; s.when.asap = !!u.when.asap; }
  }
  if (u.place && state.intent !== 'cancel') { if (state.intent === 'address_change') s.new_place = u.place; else if (s.place && !u.landmark && isArea(s.place, profile) && !isArea(u.place, profile)) { s.landmark = u.place; } // HD_513: "Simba Drive" after "Rongai" is an address note, not a new area
    else { s.landmark = u.landmark || (u.place === s.place ? s.landmark : null); s.place = u.place; } }
  if (u.service && (!s.service || !state.intent || state.phase !== 'readback' || (csOn() && state.pending?.tool === 'create_booking'))) s.service = u.service.name;
  if (u.products.length) {
    for (const p of u.products) {
      const ex = s.items.find((x) => x.product_id === p.product_id);
      if (ex) { if (p.qty) ex.qty = p.qty; } else s.items.push({ product_id: p.product_id, name: p.name, qty: p.qty });
    }
  }
  if (state.expecting === 'qty' && u.quantity) { const it = s.items.find((x) => !x.qty); if (it) it.qty = u.quantity; }
  // BRAIN_V2_COMMIT_SAFETY: "make it 3" at an order read-back changes the one item's quantity (a slot diff, so it re-proposes)
  if (csOn() && state.phase === 'readback' && state.pending?.tool === 'create_order' && u.quantity && !u.products.length && s.items.length === 1) s.items[0] = { ...s.items[0], qty: u.quantity };
}

function resolveRow(state, u) {
  // Cancel / move / address change act on visits only. An open callback or enquiry
  // request is not a booking the caller can cancel here.
  const rows = state.file.openRows.filter((r) => r.kind !== 'request' && !/cancel|done/.test(r.status));
  if (!rows.length) return { none: true };
  const hint = u.rowHint || u.text;
  const svc = N.matchService(hint, rows.map((r) => ({ name: r.service })));
  const d = L.parseDate(hint, state.now);
  let c = rows.filter((r) => (!svc || r.service === svc.name) && (!d || r.when.date === d.date));
  if (!svc && !d) c = rows.length === 1 ? rows : [];
  if (c.length === 1) return { row: c[0] };
  // a single open row is never offered as "Which one: X?" (the read-back still confirms it)
  if (!c.length && rows.length === 1) return { row: rows[0] };
  return { ambiguous: (c.length ? c : rows) };
}

// HD_cc0481620c50 (01:39 EAT): "kesho" between 00:00 and 04:59 is ambiguous (later today or the next day).
// Hold the date, confirm once, and take the caller's answer; never ask a second time in the call.
function resolveSmallHoursKesho(state, u, text) {
  if (u.when?.conflict && !state.kesho && state.phase === 'collect') { const c = u.when.conflict; state.kesho = { kind: c.kind || 'conflict', today: c.a, todayDow: c.aDow, tomorrow: c.b, tomorrowDow: c.bDow, asked: false, done: false }; delete u.when.conflict; }
  const k = state.kesho;
  if (k && k.asked && !k.done && state.expecting === 'kesho') {
    k.done = true; state.expecting = null;
    const t = String(text || '').toLowerCase();
    const num = (iso) => Number(String(iso).slice(8, 10));
    if (k.kind === 'next') {
      const nA = num(k.today), nB = num(k.tomorrow);
      const b = new RegExp(`\\b(next|ijayo|following|the one after|wiki ijayo|${nB}(st|nd|rd|th)?)\\b`).test(t);
      const a = new RegExp(`\\b(this|hii|wiki hii|this week|coming|${nA}(st|nd|rd|th)?)\\b`).test(t);
      const date = b && !a ? k.tomorrow : a && !b ? k.today : null;
      if (date) { u.when = { date, time: u.when?.time || null, raw: 'next-confirmed' }; u.yes = false; u.no = false; }
      return;
    }
    const tom = new RegExp(`\\b(${L.DOW_EN[k.tomorrowDow]}|${L.DOW_SW[k.tomorrowDow]}|${k.kind === 'conflict' ? `${num(k.tomorrow)}(st|nd|rd|th)?` : 'kesho|tomorrow|next day'})\\b`).test(t);
    const tod = new RegExp(`\\b(${L.DOW_EN[k.todayDow]}|${L.DOW_SW[k.todayDow]}|${k.kind === 'conflict' ? `${num(k.today)}(st|nd|rd|th)?` : 'leo|today|later today|this (morning|afternoon|evening)|mchana|hii'})\\b`).test(t);
    const date = tom && !tod ? k.tomorrow : tod && !tom ? k.today : (u.when?.date && !u.when.smallHours ? u.when.date : null);
    if (date) { u.when = { date, time: u.when?.time || null, raw: u.when?.raw || 'kesho-confirmed' }; u.yes = false; u.no = false; }
    else if (u.when) delete u.when.smallHours;
    return;
  }
  if (u.when?.smallHours) {
    if (!k && state.phase === 'collect') { state.kesho = { ...u.when.smallHours, asked: false, done: false }; u.when.date = null; }
    else if (k && k.done) u.when.date = k.tomorrow; // already confirmed once: never ask again
    delete u.when.smallHours;
  }
}

function askSlot(state, slot, ctx) {
  // HD_cc0481620c50: a small-hours "kesho" is confirmed once, in the caller's language, instead of asking the day from scratch
  if ((slot === 'date' || slot === 'pickup') && state.kesho && !state.kesho.asked) {
    state.kesho.asked = true; state.expecting = 'kesho';
    const S = L.isSw(state.lang); const dn = (i) => L.cap((S ? L.DOW_SW : L.DOW_EN)[i]);
    const dnum = (iso) => Number(String(iso).slice(8, 10));
    return R.ask({ conflict: 'date_conflict', next: 'next_dow' }[state.kesho.kind] || 'kesho', 0, state.lang, { today: dn(state.kesho.todayDow), tomorrow: dn(state.kesho.tomorrowDow), todayD: dnum(state.kesho.today), tomorrowD: dnum(state.kesho.tomorrow) });
  }
  const n = state.asked[slot] || 0;
  state.asked[slot] = n + 1;
  state.expecting = slot;
  if (n >= 2 || (slot === 'name' && n >= 2)) return null; // ladder exhausted
  return R.ask(slot, n, state.lang, ctx);
}

function mint(state) { state.tokenSeq += 1; return `ct_${state.turn}x${state.tokenSeq}`; }
function propose(state, p) {
  state.echoAsked = false; p.token = mint(state);
  if (csOn()) {
    if (p.tool === 'create_handoff') {
      p.phone = p.phone || state.callerPhone || null; p.phoneSaid = CS.sayPhone(p.phone);
      const w = p.callbackAt ? { ...p.callbackAt } : state.intent === 'handoff' && (state.slots.when.date || state.slots.when.time) ? { ...state.slots.when } : null;
      p.callbackWhen = CS.callbackWhen({ profile: state.profileRef || {}, now: state.now || new Date(), when: w, L });
    }
    p.issuedTurn = state.turn; p.slotHash = CS.slotHash(p); p.token = `ct_${p.slotHash.slice(0, 8)}_${state.turn}x${state.tokenSeq}`;
    p.idemKey = CS.idempotencyKey({ callId: state.callId, p }); p.validators = p.validators || state.lastValidators || {}; state.lastValidators = null;
    state.record?.('proposed', p);
  }
  state.pending = p; state.phase = 'readback'; state.expecting = 'confirm';
  const line = R.readback(p, state.lang); p.readbackLine = line; // A4: what the caller heard read back
  return line;
}
// Validators before a booking is proposed (BRAIN_V2_COMMIT_SAFETY): hours ran above; service area and
// availability here. A failed validator returns a spoken template alternative; it never says booked.
const KNOWN_TOWNS = /^(mombasa|kisumu|nakuru|eldoret|naivasha|nyeri|machakos|malindi|kitale|meru|kakamega|garissa|nanyuki|kericho|embu|kisii|lamu|diani|kilifi|voi|narok|nyahururu|bungoma|busia|migori|homa bay|isiolo|marsabit|lodwar|wajir|mandera|kitui|makueni|murang'?a|kerugoya|othaya|limuru|naro moru)$/i;
function bookingValidators(state, profile) {
  const s = state.slots; const v = { hours: 'ok' };
  const listed = listedAreaIds(profile);
  if (listed.length && s.place) {
    const m = N.matchArea(s.place, profile);
    // reject only a place we know is outside the tenant's areas; an unknown word (an estate, a street) is confirmed by the read-back
    const known = (m && m.listed === false) || (!m && KNOWN_TOWNS.test(String(s.place).trim()));
    if (m && m.listed) v.area = 'ok'; else if (!known) v.area = 'unknown';
    if (known) {
      v.area = 'unlisted'; state.lastValidators = v;
      const place = s.place; s.place = null; s.landmark = null;
      const areas = joinList(listedAreaRows(profile).map((r) => r.name).filter(Boolean).slice(0, 4), state.lang);
      const cb = propose(state, { tool: 'create_handoff', kind: 'callback', reason: 'callback', place, topic: s.service }); state.intent = 'handoff';
      // never read a mis-heard sentence back as a place name
      const say = String(place).split(/\s+/).length <= 3 && !/\b(nataka|naomba|book|clean\w*|usafi|saa|asubuhi|ijumaa|friday)\b/i.test(place) ? place : (L.isSw(state.lang) ? 'eneo hilo' : 'that area');
      if (say !== place) { state.pending.place = null; }
      return { line: `${R.info({ kind: 'area_out', place: say, areas }, state.lang)} ${say === place ? cb : R.readback(state.pending, state.lang)}` };
    }
  } else v.area = listed.length ? 'ok' : 'no_area_list';
  // availability: the caller's own open visit at that slot, then the tenant's known busy slots (none = unchecked)
  const mine = state.file.openRows.find((r) => r.kind === 'visit' && !/cancel|done/.test(r.status || '') && r.when.date === s.when.date && r.when.time === s.when.time);
  if (mine) { v.availability = 'caller_has_booking'; const label = R.rowLabel(mine, state.lang); s.when.time = null; state.expecting = 'time'; return { line: R.info({ kind: 'already_booked', label }, state.lang) }; }
  const busy = Array.isArray(profile.busySlots) ? profile.busySlots : null;
  if (busy) {
    const taken = busy.some((b) => b && b.date === s.when.date && b.time === s.when.time && (!b.service || String(b.service).toLowerCase() === String(s.service || '').toLowerCase()));
    if (taken) { v.availability = 'taken'; s.when.time = null; state.expecting = 'time'; return { line: R.info({ kind: 'slot_taken' }, state.lang) }; }
    v.availability = 'ok';
  } else v.availability = 'unchecked';
  state.lastValidators = v;
  return null;
}

// Returns { line } or { ladder:true } when a slot ask is exhausted.
function stepIntent(state, u, profile) {
  const s = state.slots;
  const it = state.intent;
  if (it === 'book') {
    if (!s.service) { if (u.intents.includes('book') && !u.service && /\b(clean|usafi|kusafisha)\b/i.test(u.text) && !profile.servicesCatalog?.length) return { line: R.info({ kind: 'not_offered' }, state.lang) }; return slotOr(state, 'service'); }
    if (!s.when.date) return slotOr(state, 'date');
    if (!s.when.time) return slotOr(state, 'time', { day: L.sayDate(s.when.date, state.lang).split(' ')[0] });
    const hp = hoursProblem(profile, s.when, state.now);
    if (hp) {
      state.hoursAsk = (state.hoursAsk || 0) + 1;
      if (hp.kind === 'closed_day' || hp.kind === 'closing_today') { s.when.date = null; s.when.time = null; } else s.when.time = null;
      state.expecting = hp.kind === 'closed_day' || hp.kind === 'closing_today' ? 'date' : 'time';
      if (state.hoursAsk <= 2) return { line: R.info({ ...hp, day: L.sayDate(s.when.date || hp.date, state.lang).split(' ')[0] }, state.lang) };
      return slotOr(state, hp.kind === 'closed_day' ? 'date' : 'time', { day: L.sayDate(s.when.date || hp.date, state.lang).split(' ')[0] });
    }
    if (!s.place) return slotOr(state, 'place');
    if (!s.name && (state.asked.name || 0) < 2) return slotOr(state, 'name');
    if (csOn()) { const bad = bookingValidators(state, profile); if (bad) return bad; }
    return { line: propose(state, { tool: 'create_booking', service: s.service, when: { ...s.when }, place: s.place, landmark: s.landmark || null, name: nameSpeakable(state) }) };
  }
  if (it === 'order') {
    if (!s.items.length) return slotOr(state, 'items');
    // BRAIN_V2_NLU_GAPS §6b (HD_2847152f6c1e): an order only carries catalogue-resolved items that are in stock;
    // an out-of-stock item is answered from the catalogue and dropped before any read-back.
    if (N.gapsOn()) {
      const out = s.items.find((x) => { const p = (profile.productCatalog || []).find((q, i) => (q.id || `prd_${i}`) === x.product_id); return !p || /^(no|false|0|out)/i.test(String(p.in_stock ?? 'yes')); });
      if (out) { s.items = s.items.filter((x) => x !== out); state.offer = 'callback'; return { line: R.info({ kind: 'stock', found: true, label: out.name, in_stock: false }, state.lang) }; }
    }
    const noQty = s.items.find((x) => !x.qty);
    if (noQty) return slotOr(state, 'qty', { item: noQty.name });
    if (!s.when.date) return slotOr(state, 'pickup');
    if (csOn()) { const hp = hoursProblem(profile, { date: s.when.date, time: '12:00' }, null); if (hp && hp.kind === 'closed_day') { s.when.date = null; state.expecting = 'pickup'; return { line: R.info({ kind: 'pickup_closed', dayLabel: L.cap((L.isSw(state.lang) ? L.DOW_SW : L.DOW_EN)[hp.dow]) }, state.lang) }; } state.lastValidators = { hours: 'ok', availability: 'unchecked' }; }
    if (!s.name && (state.asked.name || 0) < 2) return slotOr(state, 'name');
    return { line: propose(state, { tool: 'create_order', items: s.items.map((x) => ({ ...x })), pickup: { ...s.when }, name: nameSpeakable(state) }) };
  }
  if (it === 'cancel' || it === 'change' || it === 'address_change') {
    if (!s.row) {
      const rr = resolveRow(state, u);
      if (rr.none) { if (it === 'address_change') return addressHandoff(state); state.intent = null; return { line: R.info({ kind: 'no_rows' }, state.lang) }; }
      if (rr.row) s.row = rr.row;
      else return slotOr(state, 'which', { list: rr.ambiguous.map((r) => R.rowLabel(r, state.lang).replace(/^/, state.lang && L.isSw(state.lang) ? '' : 'the ')).join(L.isSw(state.lang) ? ' au ' : ', or ') });
    }
    if (it === 'cancel') return { line: propose(state, { tool: 'cancel_booking', row: s.row }) };
    if (it === 'address_change') return addressHandoff(state);
    if (!s.new_when.date && !s.new_when.time) return slotOr(state, (state.asked.change_what ? 'new_when' : 'change_what'), { row: R.rowLabel(s.row, state.lang) });
    const nw = { date: s.new_when.date || s.row.when.date, time: s.new_when.time || s.row.when.time };
    if (!nw.time) return slotOr(state, 'new_when');
    return { line: propose(state, { tool: 'update_booking', row: s.row, when: nw }) };
  }
  if (it === 'payment_change') return { line: propose(state, { tool: 'create_handoff', kind: 'payment', reason: 'owner_only_change' }) };
  if (it === 'handoff') return { line: propose(state, { tool: 'create_handoff', kind: /manager|owner|mwenye biashara|meneja|human|person/i.test(u.text || '') ? 'manager' : 'callback', reason: 'callback', topic: s.service }) };
  if (it === 'complaint') {
    s.complaint.push(u.text.slice(0, 200));
    if (s.complaint.length < 2 && !u.done) { state.expecting = 'complaint_more'; return { line: R.ask('complaint_more', 0, state.lang) }; }
    return { commitNow: { tool: 'log_complaint', category: /sofa|damag|harib/i.test(s.complaint.join(' ')) ? 'damage' : 'service_quality', summary: s.complaint.join(' / ').slice(0, 200) } };
  }
  return null;
}
// Tenant hours (hoursSchedule.days): a visit must start on an open day, at or after opening,
// before closing, and not earlier than now. Returns null when the slot is fine or hours are unknown.
function hoursProblem(profile, when, now) {
  if (!when?.date || !when?.time) return null;
  const days = profile.hoursSchedule?.days; if (!days) return null;
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dow = new Date(`${when.date}T12:00:00Z`).getUTCDay(); const h = days[keys[dow]];
  if (h && (h.closed || !h.open)) return { kind: 'closed_day', dayLabel: L.cap(L.DOW_EN[dow]), dow, date: when.date };
  const iso = L.whenToIso(when);
  if (now && iso && new Date(iso).getTime() <= now.getTime()) return { kind: 'time_past', date: when.date };
  if (when.asap && h && h.close && when.time >= h.close) return { kind: 'closing_today', close: h.close, date: null };
  if (h && h.open && h.close && (when.time < h.open || when.time >= h.close)) return { kind: 'time_outside', open: h.open, close: h.close, date: when.date };
  return null;
}
function addressHandoff(state) {
  const pend = state.file.pendingTasks.find((t) => t.kind === 'owner_only_change' && t.what === 'address' && t.status === 'open');
  if (pend) { state.intent = null; return { line: R.info({ kind: 'pending', what: 'address' }, state.lang) }; }
  return { line: propose(state, { tool: 'create_handoff', kind: 'address', reason: 'owner_only_change', place: state.slots.new_place, row: state.slots.row }) };
}
function slotOr(state, slot, ctx) {
  const line = askSlot(state, slot, ctx);
  if (line) return { line };
  // HD_4ec204aafa93: a day without a time keeps collecting; no callback rescue.
  if ((slot === 'time' || slot === 'when') && state.slots.when?.date && state.stuck !== 2) { state.stuck = (state.stuck || 0) + 1; state.asked[slot] = 1; return { line: R.ask(slot, 1, state.lang, ctx) }; }
  // the caller gave something new this turn: keep collecting, no ladder yet
  if (state.progressTurn === state.turn && !state.ladderOffered) { state.asked[slot] = 1; return { line: R.ask(slot, 1, state.lang, ctx) }; }
  // ladder step 3: offer a callback with what we captured (once per call)
  if (state.ladderOffered) {
    // HD_db0e864043c1: never loop the same ask; after it is exhausted again, stop the booking attempt.
    state.stuck = (state.stuck || 0) + 1;
    if (state.stuck >= 2) { state.stuck = 0; resetIntent(state); return { line: R.info({ kind: 'drop_intent' }, state.lang) }; }
    state.asked[slot] = 1; return { line: R.ask(slot, 1, state.lang, ctx) };
  }
  state.ladderOffered = true;
  return { line: propose(state, { tool: 'create_handoff', kind: 'ladder', reason: 'callback', missing: slot }) };
}

async function commit(state, p, handlers) {
  if (csOn()) return commitSafe(state, p, handlers);
  return commitRaw(state, p, handlers);
}
// BRAIN_V2_COMMIT_SAFETY commit: one write per idempotency key; receipts for confirmed / committed / failed;
// a failed write opens an outbox owner task and is never counted as booked.
async function commitSafe(state, p, handlers) {
  const key = p.idemKey || CS.idempotencyKey({ callId: state.callId, p });
  state.committedKeys = state.committedKeys || {};
  const prior = state.committedKeys[key];
  if (prior) { const rec = { ...prior, duplicate: true }; state.receipts.push(rec); return { rec, toolResult: { action: prior.action, status: 'duplicate', code: null, v2: true, idempotencyKey: key } }; }
  const t0 = Date.now();
  const before = state.outcomes.length;
  const out = await commitRaw(state, p, handlers, { idempotencyKey: key });
  const { rec } = out;
  if (!rec.ok) {
    state.outcomes.length = before; // a failed write is not booked / saved (A4)
    let task = null;
    try { task = await handlers.escalate({ reason: `write_failed:${p.tool}`, kind: 'outbox', name: state.slots.name || null, captured: { tool: p.tool, idempotencyKey: key, service: p.service || null, when: p.when ? `${p.when.date || ''} ${p.when.time || ''}`.trim() : null, place: p.place || null, items: p.items ? p.items.map((x) => `${x.qty} x ${x.name}`).join(', ') : null, callback_when: p.callbackWhen ? p.callbackWhen.say('en') : null } }); } catch { task = null; }
    rec.outbox = task && task.ok !== false ? 'queued' : 'failed';
    state.outcomes.push('write_failed');
    state.record?.('failed', p, { errorCode: 'write_failed', outboxTaskId: task?.id || null, latencyMs: Date.now() - t0 });
    out.toolResult.outbox = rec.outbox;
  } else {
    rec.idempotencyKey = key;
    if (p.callbackWhen) rec.callbackSay = `${p.phoneSaid ? (L.isSw(state.lang) ? `kwa namba ${p.phoneSaid}` : `on ${p.phoneSaid}`) : (L.isSw(state.lang) ? 'kwa namba hii' : 'on this number')}, ${p.callbackWhen.say(state.lang)}`;
    state.committedKeys[key] = rec;
    state.record?.('committed', p, { writeTable: { create_booking: 'appointments', update_booking: 'appointments', cancel_booking: 'appointments', create_order: 'service_requests' }[p.tool] || 'tasks', writeId: rec.id || null, latencyMs: Date.now() - t0 });
  }
  out.toolResult.idempotencyKey = key;
  return out;
}
async function commitRaw(state, p, handlers, extra = {}) {
  const s = state.slots;
  const name = s.name || null;
  const ik = extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {};
  const cb = p.callbackWhen ? { phone: p.phone || null, callbackWhen: p.callbackWhen.say('en') } : {};
  let ok = false; let result = null; let action = p.tool;
  try {
    if (p.tool === 'create_booking') {
      action = 'create_appointment';
      result = await handlers.createAppointment({ ...ik, serviceName: p.service, whenText: `${p.when.date} ${p.when.time}`, windowStart: L.whenToIso(p.when), landmark: p.place, notes: p.landmark || undefined, name, ...(openCallbacks(state).length ? { supersedes: openCallbacks(state) } : {}) });
      ok = Boolean(result && (result.id || result.dryRun === true)); state.outcomes.push('booked');
    } else if (p.tool === 'create_order') {
      action = 'create_service_request';
      result = await handlers.createServiceRequest({ ...ik, type: 'order', item: p.items.map((x) => `${x.qty} x ${x.name}`).join(', '), quantity: String(p.items.reduce((a, x) => a + x.qty, 0)), whenText: p.pickup.date, name, notes: p.items.map((x) => x.name).join(', ') });
      ok = Boolean(result && (result.id || result.dryRun === true)); state.outcomes.push('order_saved');
    } else if (p.tool === 'cancel_booking') {
      action = 'update_appointment';
      result = await handlers.updateAppointment({ appointmentId: p.row.id, status: 'cancelled' });
      ok = Boolean(result && (result.id === p.row.id || result.dryRun === true)); state.outcomes.push('cancelled');
    } else if (p.tool === 'update_booking') {
      action = 'update_appointment';
      result = await handlers.updateAppointment({ appointmentId: p.row.id, whenText: `${p.when.date} ${p.when.time}`, windowStart: L.whenToIso(p.when) });
      ok = Boolean(result && (result.id === p.row.id || result.dryRun === true)); state.outcomes.push('moved');
    } else if (p.tool === 'create_handoff') {
      result = await handlers.escalate({ ...ik, reason: p.reason === 'owner_only_change' ? `owner_only_change:${p.kind}` : `callback:${p.kind}`, name, captured: { place: p.place || null, booking: p.row?.id || null, missing: p.missing || null, ...cb } });
      ok = Boolean(result && result.ok !== false); state.outcomes.push(p.reason === 'owner_only_change' ? 'owner_only_change' : 'handoff_callback');
      // HD_4ec204aafa93: remember this call's open callback so a later booking supersedes it.
      if (ok && p.reason !== 'owner_only_change') state.callbacks.push({ id: result.id || result.taskId || null, kind: p.kind || 'callback', open: true });
    } else if (p.tool === 'log_complaint') {
      result = await handlers.escalate({ reason: `complaint:${p.category}`, name, summary: p.summary, kind: 'complaint' });
      ok = Boolean(result && result.ok !== false); state.outcomes.push('complaint');
    }
  } catch (e) { ok = false; }
  const sup = ok && p.tool === 'create_booking' ? openCallbacks(state) : [];
  if (sup.length || (ok && p.tool === 'create_booking')) for (const c of state.callbacks) if (c.open) { c.open = false; c.supersededBy = result?.id || null; }
  const rec = { tool: p.tool, action, ok, id: result?.id || null, ...(sup.length ? { supersedes: sup } : {}), notify: result?.notify || null, service: p.service || null, when: p.when || null, items: p.items || null, pickup: p.pickup || null, row: p.row || null, kind: p.kind || null, place: p.place || null, readbackLine: p.readbackLine || null, replyText: p.replyText || null, idempotencyKey: extra.idempotencyKey || p.idemKey || null };
  state.receipts.push(rec);
  if (ok && (p.tool === 'create_booking' || p.tool === 'create_order') && s.name && handlers.saveCallerInfo) {
    const prior = state.file.contactName;
    const replace = !prior || (s.nameCorrectionOf && prior.toLowerCase() === s.nameCorrectionOf.toLowerCase());
    try { await handlers.saveCallerInfo({ name: s.name, replace }); } catch {}
  }
  if (ok && p.tool === 'cancel_booking') { const r = state.file.openRows.find((x) => x.id === p.row.id); if (r) r.status = 'cancelled'; }
  return { rec, toolResult: { action, status: ok ? 'succeeded' : 'failed', code: ok ? null : 'write_failed', v2: true, ...(sup.length ? { supersedes: sup } : {}) } };
}

// Open callbacks created earlier in this call (ids may be null in dry-run).
function openCallbacks(state) { return (state.callbacks || []).filter((c) => c.open).map((c) => c.id).filter(Boolean); }
function isArea(place, profile) { return !!(N.matchArea(place, profile)?.listed || /^(Kitengela|Ruiru|Kasarani|Kilimani|Karen|Westlands|Lavington|Kileleshwa|Rongai|Syokimau|Thika|Juja|Embakasi|Langata|Ngong|Kahawa|Roysambu|Donholm|Umoja|Kikuyu|Parklands|South B|South C|Athi River|Kiambu|Nairobi)$/i.test(String(place || '').trim())); }
function resetIntent(state) {
  const keep = { name: state.slots.name, nameConfirmed: state.slots.nameConfirmed, nameCorrectionOf: state.slots.nameCorrectionOf };
  state.slots = { service: null, when: { date: null, time: null }, place: null, items: [], row: null, new_when: { date: null, time: null }, new_place: null, kind: null, topic: null, complaint: [], ...keep };
  state.intent = null; state.phase = 'collect'; state.pending = null; state.expecting = null; state.asked = { name: state.asked.name || 0 };
}

function echoAffirms(p, u) {
  if (u.negation || u.no) return false;
  // Alvin (15 Oct): the caller repeating the read-back TIME exactly ("saa 4", "Uh, 10am") is a yes; a day alone is not.
  // One shared rule for every read-back that states a time (CS.timeEcho), not a per-tool copy.
  return CS.timeEcho(p, u) === 'same';
}
function pendingChanged(p, state) {
  const s = state.slots;
  if (p.tool === 'create_booking') return p.service !== s.service || p.when.date !== s.when.date || p.when.time !== s.when.time || p.place !== s.place || (p.landmark || null) !== (s.landmark || null);
  if (p.tool === 'update_booking') return (s.new_when.date && s.new_when.date !== p.when.date) || (s.new_when.time && s.new_when.time !== p.when.time);
  return false;
}

// BRAIN_V2_COMMIT_SAFETY: any slot change against the proposal's hash re-proposes.
function csChanged(p, state) {
  const s = state.slots;
  if (p.tool === 'create_booking') return CS.slotHash({ ...p, service: s.service, when: { ...s.when }, place: s.place, landmark: s.landmark || null }) !== p.slotHash;
  if (p.tool === 'create_order') return CS.slotHash({ ...p, items: s.items, pickup: { ...s.when } }) !== p.slotHash;
  return Boolean(pendingChanged(p, state));
}
// BRAIN_V2_COMMIT_SAFETY read-back turn: confirm only on the NEXT turn after the read-back, on an explicit
// whole-answer yes or a repeat of the read-back time, with no slot diff. Returns a turn result, or null to
// let the turn fall through to intent handling (after one re-read the read-back is dropped).
async function confirmSafe(state, u, profile, handlers, out, results, myTurn = state.turn) {
  const p = state.pending; const lang = state.lang || 'en';
  mergeSlots(state, u, profile);
  const q = () => (String(R.readback(p, lang) || '').match(/[^.!?]+\?\s*$/) || [''])[0].trim();
  if (csChanged(p, state)) {
    state.record?.('rejected', p, { errorCode: 'slot_diff' });
    state.phase = 'collect'; state.pending = null;
    const st = stepIntent(state, u, profile); if (st?.line) return out(st.line);
    return null;
  }
  const nextTurn = myTurn === p.issuedTurn + 1;
  // the shared read-back classifier (Alvin's rule): exact repeat of the read-back time = yes, a different
  // time = change, "okay wait" / a question = unclear (one re-ask)
  const ans = CS.readbackAnswer(p, u);
  const yesDone = ans.done;
  const yes = ans.kind === 'yes';
  if (ans.kind === 'change' && p.tool === 'create_handoff') {
    // a different callback time re-proposes with that time (bookings re-propose through the slot diff above)
    const rt = CS.readbackTime(p) || {};
    state.record?.('rejected', p, { errorCode: 'slot_diff' });
    const at = { date: u.when.date || rt.date || null, time: u.when.time || null };
    return out(propose(state, { ...p, callbackAt: at }));
  }
  if (yes && nextTurn) {
    state.pending = null; state.phase = 'committing'; // consumed before any await: a second yes cannot redeem it
    state.record?.('confirmed', p, { confirmedTurn: state.turn });
    p.replyText = String(u.text || '').slice(0, 160); // A4: callback read-back evidence
    if (p.name && state.slots.name && typeof handlers.confirmCallerName === 'function') { try { const r = handlers.confirmCallerName({ name: state.slots.name, source: 'readback_yes' }); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* never blocks */ } }
    const { rec, toolResult } = await commit(state, p, handlers);
    results.push(toolResult);
    let line = R.receipt(rec, lang);
    resetIntent(state);
    if (rec.ok && p.tool === 'cancel_booking' && state.queuedBook) {
      const qb = N.understand(state.queuedBook, { profile, now: state.now }); state.queuedBook = null;
      if (qb.service) { state.intent = 'book'; mergeSlots(state, qb, profile); const st = stepIntent(state, qb, profile); if (st?.line) line = `${line.replace(/\s*(Anything else\?|Kuna kingine\?)$/, '')} ${st.line}`; }
    }
    if (yesDone && rec.ok) { state.ended = true; return out(`${line.replace(/\s*(Anything else\?|Kuna kingine\?)$/, '')} ${R.info({ kind: 'bye' }, lang)}`, { ackOk: true, end: true }); }
    return out(line, { ackOk: true });
  }
  if (yes) return out(propose(state, { ...p })); // a yes that is not on the next turn: read back again, fresh token
  if (u.no || u.done) { state.record?.('rejected', p, { errorCode: u.done ? 'caller_done' : 'caller_no' }); resetIntent(state); state.outcomes.push('declined'); return out(u.done ? R.info({ kind: 'bye' }, lang) : R.info({ kind: 'decline' }, lang), { end: u.done }); }
  // "okay wait, let me check with my wife": nothing saved; the read-back stays open for the next turn
  if (u.intents.includes('hold') || /\b(wait|ngoja|subiri|hold on|let me (check|ask|confirm|think)|nitaangalia|niulize|nifikirie)\b/i.test(u.text)) { p.issuedTurn = state.turn; return out(`${R.info({ kind: 'hold' }, lang)} ${q()}`); }
  state.pendingRepeats = (state.pendingRepeats || 0) + 1;
  if (state.pendingRepeats <= 1 && !state.echoAsked && !u.intents.length) { state.echoAsked = true; p.issuedTurn = state.turn; return out(R.ask('yes_no', 0, lang, { q: q() })); }
  if (state.pendingRepeats <= 1) return out(propose(state, { ...p }));
  state.pendingRepeats = 0; state.record?.('rejected', p, { errorCode: 'unclear' });
  if (p.tool === 'create_handoff') resetIntent(state); else { state.phase = 'collect'; state.pending = null; }
  return null;
}

function infoAnswer(state, u, profile, kind) {
  const n = state.infoRepeat[kind] || 0; state.infoRepeat[kind] = n + 1;
  if (kind === 'hours') {
    const days = profile.hoursSchedule?.days || {};
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const d = L.parseDate(u.text, state.now);
    const all = Object.values(days);
    if (d) { const k = keys[new Date(`${d.date}T12:00:00Z`).getUTCDay()]; const h = days[k] && days[k].open ? days[k] : null; const lbl = L.cap(L.isSw(state.lang) ? L.DOW_SW[keys.indexOf(k)] : L.DOW_EN[keys.indexOf(k)]); return R.info(h ? { kind: 'hours', dayLabel: lbl, open: h.open, close: h.close } : { kind: 'hours', dayLabel: lbl, closed: true }, state.lang); }
    const same = all.length === 7 && all.every((h) => h && all[0] && h.open === all[0].open && h.close === all[0].close);
    const today = days[keys[L.eatParts(state.now).dow]];
    const h = same ? all[0] : today;
    if (!h) return R.info({ kind: 'hours', dayLabel: L.isSw(state.lang) ? 'Leo' : 'today', closed: true }, state.lang);
    return R.info({ kind: 'hours', everyDay: same, open: h.open, close: h.close }, state.lang);
  }
  if (kind === 'services') {
    const cat = vertical(profile) === 'retail' ? (profile.productCatalog || []).map((p) => p.name) : (profile.servicesCatalog || []).map((x) => x.name);
    const compiled = compileSpokenCatalogue(profile, { limit: 4 });
    if (u.service) {
      // #833 live: a sized family ("Deep clean, one or two bedroom?") asks the size first
      const fam = compiled.familyForName(u.service.name);
      const sized = /\b(\d{1,2}|one|two|three|moja|mbili|tatu|kimoja|viwili|vitatu)\s*-?\s*(bedroom|chumba|vyumba|seater|kiti)?\b/i.test(u.text);
      if (fam?.askSize && !sized) {
        return R.info({
          kind: 'which_size',
          head: L.isSw(state.lang) ? fam.labelSw : fam.labelEn,
          sizes: compiled.sizeAsk(fam, state.lang),
        }, state.lang);
      }
      const sp = spoken(profile, u.service, state.lang);
      return R.info({ kind: 'offered', label: sp ? sp.label : u.service.name, price: sp ? sp.price : u.service.price_range || null }, state.lang);
    }
    if (u.products[0]) return R.info({ kind: 'offered', label: u.products[0].name, price: u.products[0].price ? `KSh ${u.products[0].price}` : null }, state.lang);
    if (!cat.length && !compiled.families.length) return R.info({ kind: 'want_know' }, state.lang);
    // HD_89aa48bf657f (VOICE_V2_CATALOGUE): home services as plain categories from the tenant's spoken catalogue
    if (vertical(profile) === 'home' && scOn() && !(u.followup || n >= 1)) { const sc = SC.resolveSpokenCatalogue(profile); const lg = L.isSw(state.lang) ? 'sw' : 'en'; const house = sc.categories.find((c) => c.id === 'house'); if (house && /\b(saizi|sizes?|ukubwa|vyumba|bedrooms?)\b/i.test(u.text || '')) return R.info({ kind: 'house_sizes', sizes: house.entryIds.map((id) => (sc.entries.find((e) => e.id === id).raw.name.match(/(\d)-Bedroom/i) || [])[1]).filter(Boolean) }, state.lang); const labels = sc.categories.map((c) => c[lg]).filter(Boolean).slice(0, 4); if (labels.length) return R.info({ kind: 'service_categories', labels }, state.lang); }
    // HD_89aa48bf657f + 7d377196 (lineage wins for home services): plain categories in the caller's language;
    // a repeat or "what exactly / zipi hasa" goes one level deeper; "what sizes?" lists bedroom sizes
    if (vertical(profile) === 'home' && cat.length) { const cats = R.serviceCategories(cat); const house = cats.find((c) => c.k === 'house'); if (u.followup || n >= 1) return R.info({ kind: 'service_detail', cats }, state.lang); if (house && /\b(saizi|sizes?|ukubwa|vyumba|bedrooms?)\b/i.test(u.text || '')) return R.info({ kind: 'house_sizes', sizes: house.names.map((x) => (x.match(/(\d)-Bedroom/i) || [])[1]).filter(Boolean) }, state.lang); if (cats.length) return R.info({ kind: 'service_categories', cats }, state.lang); }
    // #833 live spoken catalogue (other verticals): families, never raw SKU titles
    if (compiled.families.length) return R.info({ kind: 'services', names: compiled.labels(state.lang), more: compiled.more }, state.lang);
    const start = (n * 4) % cat.length;
    return R.info({ kind: 'services', names: [...cat, ...cat].slice(start, start + 4), more: cat.length > 4 }, state.lang);
  }
  if (kind === 'coverage') {
    if (u.feeAsk || FEE_ASK.test(u.text) || (!u.area && DELIVER_ASK.test(u.text))) {
      const line = compileAskReceipt(profile, { kind: 'come_cost', place: u.area && u.area.name }, state.lang);
      if (line) return R.info({ kind: 'policy', line }, state.lang);
    }
    const loc = (profile.businessLocations || [])[0];
    const compiled = compileSpokenCoverage(profile, { limit: 4 });
    const listed = compiled.all;
    const general = compiled.names.length
      ? joinList(compiled.names, state.lang)
      : (loc?.address || profile.hoursSchedule?.location?.split('·').pop()?.trim() || null);
    // "outside Nairobi" / "nje ya Nairobi": the named place is the base, not the asked area;
    // answer with the listed areas beyond it (from the tenant list only, never invented).
    const om = String(u.text || '').match(/\b(?:outside|out of|beyond|nje ya)\s+(?:the\s+)?([A-Za-z]+)/i);
    if (om && listed.length && !(u.area && u.area.name.toLowerCase() !== om[1].toLowerCase()) && !(u.place && u.place.toLowerCase() !== om[1].toLowerCase())) {
      const base = om[1].toLowerCase(); const others = listed.filter((a) => a.toLowerCase() !== base);
      // the base may be a listed county (county:nairobi), which the spoken place list leaves out
      const baseListed = listedAreaIds(profile).some((a) => a.toLowerCase() === base) || others.length < listed.length;
      if (others.length && baseListed) { state.coverageAsk = state.turn; return R.info({ kind: 'coverage_outside', base: L.cap(base), names: joinList(others.slice(0, 4), state.lang), more: others.length > 4 }, state.lang); }
    }
    if (!u.area && !u.place) state.coverageAsk = state.turn;
    return R.info({
      kind: 'coverage',
      area: u.area,
      general,
      fromList: listed.length > 0,
      more: compiled.more,
    }, state.lang);
  }
  if (kind === 'payment_how') {
    const line = compileAskReceipt(profile, { kind: 'pay' }, state.lang);
    if (/\b(Paybill|Till|benki|pesa taslimu|kadi|Pochi|Airtel)\b/i.test(line) && (profile.businessPolicies?.payments?.methods || []).length) {
      return R.info({ kind: 'payment_how', methods: line.replace(/^You can pay by |^Malipo: |\.$/g, '') }, state.lang);
    }
    return R.info({ kind: 'policy', line }, state.lang);
  }
  if (POLICY_KEY[kind]) {
    const ask = {
      policy_returns: 'refund',
      policy_deposit: 'deposit',
      policy_warranty: 'warranty',
      policy_cancel: 'cancel_rules',
    }[kind];
    return R.info({ kind: 'policy', line: compileAskReceipt(profile, { kind: ask }, state.lang) }, state.lang);
  }
  if (kind === 'greeting') return R.info({ kind: 'greeting' }, state.lang);
  if (kind === 'who_are_you') return R.info({ kind: 'who', agent: profile.agentName || 'Shy', biz: profile.businessName || '' }, state.lang);
  if (kind === 'want_know') return R.info({ kind: 'want_know' }, state.lang, n);
  if (kind === 'price') {
    const named = /\b(cleaning|clean|for (an?|the)? ?\w+|ya \w+)\b/i.test(u.text);
    const svc = u.service || (!named && u.text.split(/\s+/).length <= 5 && state.slots.service && (profile.servicesCatalog || []).find((x) => x.name === state.slots.service)); const prod = u.products[0];
    if (!svc && !prod && !/\b(oven|fridge|gutter|\w+ cleaning)\b/i.test(u.text)) return R.info({ kind: 'which_price' }, state.lang);
    if (svc && scOn()) { const sp = spoken(profile, svc, state.lang); if (sp.price && svc.pricing?.confirmed !== false) return R.info({ kind: 'price', found: true, label: sp.label, price: sp.price }, state.lang); if (svc.price_range) return R.info({ kind: 'price', found: false }, state.lang); }
    if (svc && svc.price_range && svc.pricing?.confirmed !== false) return R.info({ kind: 'price', found: true, label: svc.name, price: svc.price_range }, state.lang);
    if (prod && prod.price) return R.info({ kind: 'price', found: true, label: prod.name, price: `KSh ${prod.price}` }, state.lang);
    state.offer = 'quote';
    return R.info({ kind: 'price', found: false }, state.lang);
  }
  if (kind === 'availability') {
    const prod = u.products[0];
    if (prod) return R.info({ kind: 'stock', found: true, label: prod.name, in_stock: prod.in_stock }, state.lang, n);
    if (u.service && vertical(profile) === 'home') { state.offer = 'book'; state.offerService = u.service.name; return R.info({ kind: 'service_slot', label: spoken(profile, u.service, state.lang)?.label || u.service.name }, state.lang); }
    state.offer = 'callback';
    return R.info({ kind: 'stock', found: false }, state.lang, n);
  }
  if (kind === 'recall') {
    const rows = state.file.openRows.filter((r) => r.status !== 'cancelled');
    if (!rows.length) state.offer = n >= 1 ? 'callback' : null;
    return R.info({ kind: 'file', rows }, state.lang, n);
  }
  return null;
}

// Mocked/real model hook: we show the model the typed catalogue, validate whatever it
// calls, and only ever use it to PROPOSE an intent/slot. Speech never comes from it.
async function consultModel(state, u, profile, model, catalogue) {
  if (!model) return null;
  const toolMode = state.phase === 'readback' ? 'ANY' : state.ended ? 'NONE' : 'AUTO';
  const allowed = state.phase === 'readback' ? [state.pending.tool] : null;
  const request = buildRequest({ userText: u.text, catalogue, toolMode, allowed });
  let out;
  try { out = await model({ request, state: { intent: state.intent, phase: state.phase, lang: state.lang, slots: state.slots, pendingToken: null }, text: u.text, profile, toolMode, allowed }); } catch (e) { out = { calls: [], text: '', error: String(e.message || e) }; }
  const calls = out?.calls || [];
  const checks = calls.map((c) => {
    const v = validateCall(catalogue, c);
    let code = v.ok ? null : v.code;
    if (v.ok && allowed && !allowed.includes(c.name)) code = 'not_allowed_in_state';
    if (v.ok && c.args?.confirm_token && c.args.confirm_token !== state.pending?.token) code = 'token_mismatch';
    return { name: c.name, ok: !code, code, errors: v.errors || [] };
  });
  state.trace.push({ turn: state.turn, toolMode, allowed, modelText: (out?.text || '').slice(0, 160), calls: calls.map((c) => c.name), checks });
  return { calls, checks };
}
const INTENT_OF_TOOL = { create_booking: 'book', create_order: 'order', cancel_booking: 'cancel', update_booking: 'change', log_complaint: 'complaint', create_handoff: 'handoff' };

// Ack rule (v2-ack-overuse.md, approved 14:53 EAT 14 Oct): Brain lines carry no
// leading ack ("Sawa,", "Okay.", "Haya.", "Alright.", "Sure,", "Asante,") except a
// write receipt, and only when Voice has not acked this turn (opts.acked), it is
// not the first turn, the caller did not just say "sawa", the previous turn was
// not ack-led and no ack was spoken in the last 3 turns. Goodbye is exempt but
// never paired with an ack-led turn.
const ACK_LEAD = /^\s*(?:sawa sawa|sawa kabisa|ni sawa|sawa|okay|ok|haya|alright|sure|poa|asante)\s*[,.!]\s*(?=\S)/i;
const BYE = /^(Asante kwa kupiga simu\.|Thank you for calling\.)/;
function isAckLed(line) { return ACK_LEAD.test(String(line || '')) && !BYE.test(String(line || '')); }
function stripAck(line) { const r = String(line).replace(ACK_LEAD, ''); return r.charAt(0).toUpperCase() + r.slice(1); }
function applyAckRule(state, line, { ackOk, acked, callerAck, lang }) {
  if (!line) return line;
  if (BYE.test(line)) return state.lastAckLed && /^Asante/.test(line) ? 'Karibu tena. Kwaheri.' : line;
  if (!ACK_LEAD.test(line)) return line;
  const recent = state.lastAckTurn != null && state.turn - state.lastAckTurn < 3;
  const keep = ackOk && !acked && state.turn > 1 && !state.lastAckLed && !recent;
  return keep ? line : stripAck(line);
}
function noteAck(state, line) { state.lastAckLed = isAckLed(line); if (state.lastAckLed) state.lastAckTurn = state.turn; }

async function runTurnInner(state, { text, profile = {}, now = new Date(), handlers, model = null, classify = null, langLock = null, acked = false }) {
  state.turn += 1; state.now = now;
  const myTurn = state.turn; // this turn's number even if another turn starts while this one awaits
  if (csOn()) { // non-enumerable: never serialized with the state
    Object.defineProperty(state, 'profileRef', { value: profile, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(state, 'record', { value: CS.makeRecorder(handlers, state), writable: true, configurable: true, enumerable: false });
  }
  const prevLang = state.lang;
  // langLock (Voice #677): the call language is owned by Voice; never flip mid-turn.
  state.lang = (langLock === 'en' || langLock === 'sw') ? langLock : (L.nextLanguage(state.lang, text) || state.lang);
  let areaQ = null;
  let u = N.understand(text, { profile, now, expecting: state.expecting, topic: state.lastInfo, prev: state.nluPrev || null, opening: state.turn === 1 && !state.slots.name });
  state.nluPrev = { kind: u.kind, service: u.service || null };
  // §4 "do you do X?" (BRAIN_V2_NLU_GAPS): a resolved catalogue item is answered with its grounded
  // name + price from the catalogue (checkServiceLine), never a slot/availability claim and never a re-list.
  if (u.intents.includes('check') && u.service && u.intents.length === 1 && !state.intent && vertical(profile) === 'home') {
    state.lastInfo = 'price'; mergeSlots(state, u, profile); state.offer = 'book'; state.offerService = u.service.name;
    const lang0 = state.lang || 'en'; const line = checkServiceLine(profile, u.service, lang0);
    state.lastBase = line; state.lastLine = line; noteAck(state, line);
    return { line, lang: lang0, source: 'receipt', toolResults: [], end: false };
  }
  // §6c "Chris." early in the call with no name yet: the caller's name, never "help regarding Chris?"
  if (u.nameCandidate && !u.name && !state.slots.name && !state.intent && state.turn <= 3) { u.name = u.nameCandidate; u.kind = 'give_name'; u.confidence = 0.6; u.clear = false; u.reason = 'bare_name_intro'; }
  // area clarify (only groups touching the tenant's own places): ask once, then re-read the held turn with the chosen place
  if (state.areaPick) {
    const pk = state.areaPick; state.areaPick = null;
    const low = String(text || '').toLowerCase();
    const hit = pk.options.find((o) => low.includes(o.county.toLowerCase())) || pk.options.find((o) => o.name.toLowerCase() !== pk.heard.toLowerCase() && low.includes(o.name.toLowerCase().split(' ')[0])) || (u.no && pk.options.length === 2 ? pk.options[1] : null) || (u.yes && !u.no ? pk.options[0] : null);
    if (hit) { const say = hit.listed ? hit.name : hit.county; u = N.understand(pk.text.replace(new RegExp(`\\b${pk.heard}\\b`, 'i'), say), { profile, now, expecting: pk.expecting, topic: state.lastInfo }); text = u.text; }
    else { // no pick: the caller moved on; keep the one option we serve, the read-back still confirms it
      const own = pk.options.filter((o) => o.listed);
      if (own.length === 1 && !state.slots.place && !u.place) { const h = N.understand(pk.text.replace(new RegExp(`\\b${pk.heard}\\b`, 'i'), own[0].name), { profile, now, expecting: 'place' }); if (h.place || h.area) { state.slots.place = h.place || h.area.name; if (h.landmark && !state.slots.landmark) state.slots.landmark = h.landmark; } }
    }
  } else {
    const amb = N.areaAmbiguity(text, profile);
    if (amb && (state.intent || state.expecting === 'place' || u.intents.some((i) => ['book', 'coverage'].includes(i)) || u.area)) {
      state.areaPick = { ...amb, text, expecting: state.expecting };
      const o = amb.options; const sw = L.isSw(state.lang);
      const opt = (x) => (sw ? `${x.name} ya ${x.county}` : `${x.name} in ${x.county}`);
      const q = sw ? `Ni ${o.slice(0, -1).map(opt).join(', ')} au ${opt(o[o.length - 1])}?` : `Is that ${o.slice(0, -1).map(opt).join(', ')} or ${opt(o[o.length - 1])}?`;
      areaQ = q;
    }
  }
  resolveSmallHoursKesho(state, u, text);
  const results = [];
  const catalogue = buildCatalogue({ profile, openRows: state.file.openRows });
  const mc = await consultModel(state, u, profile, model, catalogue);
  if (typeof classify === 'function' && needsClassify(u, pickIntent(u, state, profile))) {
    try {
      const ticket = normalizeTicket(await classify({ text: u.text, profile, lang: state.lang }), profile);
      applyTicket(u, ticket);
      state.trace.push({ turn: state.turn, classify: { kind: ticket.kind, listed: !!(ticket.area && ticket.area.listed) } });
    } catch { /* keep regex reading */ }
  }
  const lang = state.lang || 'en';
  let out = (line0, extra = {}) => { const line = applyAckRule(state, line0, { ackOk: !!extra.ackOk, acked: !!acked, callerAck: !!u.ack, lang }); const l = line && (line === state.lastLine || line === state.lastBase) ? (() => { const n = state.repeatN = (state.repeatN || 0) + 1; let v = R.vary(line, lang, n); if (v === state.lastLine) v = R.vary(line, lang, n, true); return v; })() : line; state.lastBase = line; state.lastLine = l; noteAck(state, l); return { line: l, lang, source: extra.source || 'receipt', toolResults: results, end: !!extra.end, ...(extra.end ? { endReason: extra.endReason || 'caller_done' } : {}) }; };
  if (csOn()) { // any line that ends on the read-back question re-arms the confirm token for the caller's next turn
    const out0 = out;
    out = (line0, extra) => { const r = out0(line0, extra); const p = state.phase === 'readback' && state.pending; if (p) { const q = (String(R.readback(p, lang) || '').match(/[^.!?]+\?\s*$/) || [''])[0].trim(); if (q && String(r.line || '').trim().endsWith(q)) p.issuedTurn = state.turn; } return r; };
  }
  if (areaQ) return out(areaQ);

  // HD_db0e864043c1 fixes -------------------------------------------------
  // "pardon?" / "say again" repeats our last line plainly (not a new question).
  if (/^\W*(uh,?\s*)?(pardon( me)?|sorry\??|say (that|it) again|come again|repeat( that)?|rudia|sijakusikia|sijaskia|nini\?)\W*$/i.test(text) && state.lastLine) return out(state.lastLine);
  // "what's my name?" answers from the caller file / this call only; never claims memory.
  if (/\b(naitwa nani|jina langu ni nani|what'?s my name|do you know my name|unajua jina langu)\b/i.test(text)) {
    const known = state.slots.name || state.file.contactName;
    if (known) return out(lang === 'sw' ? `Nina jina lako kama ${known}. Ni sahihi?` : `I have your name as ${known}. Is that right?`);
    state.asked.name = (state.asked.name || 0) + 1; state.expecting = 'name';
    return out(lang === 'sw' ? 'Sina jina lako bado. Naomba jina lako?' : "I don't have your name yet. May I have your name?");
  }
  // "who did you escalate to?" answers from this call's own receipts only
  if (/\b(escalat\w*|umemtumia nani|who did you (send|tell|pass)|umepeleka kwa nani)\b/i.test(text) && (state.callbacks || []).length) return out(lang === 'sw' ? 'Nimeomba timu ya biashara ikupigie simu kwa namba hii.' : 'I asked the business team to call you back on this number.');
  // a bare place right after our "which place are you in?" coverage answer is the coverage follow-up
  if (state.coverageAsk === state.turn - 1 && !u.intents.length && !state.intent && text.split(/\s+/).length <= 5) {
    const pl = u.place || N.extractPlace(text, { prompted: true });
    if (u.area || pl) { u.place = u.place || pl; if (!u.area) u.area = { listed: false, name: L.cap(String(pl).split(/[ ,]/)[0]) }; u.intents.push('coverage'); }
  }
  // a place asked as a question ("Of Naivasha?") is a coverage question
  if ((u.place || /^\W*(of|in|kama|like|what about|na je|je)\s+[A-Z][a-z]{3,}\W*$/i.test(text)) && /\?\s*$/.test(text) && !u.intents.includes('coverage') && !u.intents.includes('book')) u.intents.push('coverage');
  // "are you a bot?": always honest, then back to the open question (never a booking change)
  if (u.intents.includes('bot_q')) {
    const q = state.expecting && (String(state.lastBase || state.lastLine || '').match(/[^.!?]+\?\s*$/) || [])[0];
    return out(`${R.info({ kind: 'bot', agent: profile.agentName || 'Shy', biz: profile.businessName || '' }, lang)}${q ? ` ${q.trim()}` : ''}`);
  }
  // hold / line checks / ASR tags while collecting: keep every slot, re-ask the open question
  if (state.intent && state.expecting && N.nonAnswer(text) && !u.when && !u.service) {
    const q = (String(state.lastBase || state.lastLine || '').match(/[^.!?]+\?\s*$/) || [])[0];
    if (q) return out(u.intents.includes('hold') ? `${R.info({ kind: 'hold' }, lang)} ${q.trim()}` : `${R.info({ kind: 'repair' }, lang).split(/(?<=[.!?])\s/)[0]} ${q.trim()}`);
  }
  // HD_89aa48bf657f T5: "what do you mean by 1-Bedroom?" gets a short plain explanation, no price, no booking push
  if (u.intents.includes('explain') && u.service) { const svc = u.service; if (state.intent === 'book' && state.slots.service === svc.name && state.phase === 'collect' && !state.slots.when.date) state.slots.service = state.slotsServiceBefore || null; const sp = spoken(profile, svc, lang); return out(sp && sp.explain ? R.info({ kind: 'explain_text', text: sp.explain }, lang) : R.info({ kind: 'explain', name: svc.name, notes: svc.notes || '' }, lang)); }
  // thanks-only while collecting and nothing new: the caller is closing
  if (state.phase === 'collect' && state.turn > 2 && /^\W*((okay|ok|sawa|alright)\W+)?(thank you|thanks|asante( sana)?)\W*$/i.test(text)) { resetIntent(state); state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true, endReason: 'caller_thanks' }); }
  // after "anything else?": a no, thanks or a compliment closes the call
  const askedElse = /(anything else|Kuna kingine)[^?]*\?\s*$/i.test(state.lastLine || '');
  // a cut-off turn ("Hapana, n") is never a no / decline / slot answer: ask again, keep everything
  if (N.cutOff(text) && state.turn > 1 && (state.repairs || 0) < 2) {
    state.repairs = (state.repairs || 0) + 1;
    // re-ask the open question so the caller knows what to answer ("Sorry, I didn't catch that. Where should we come?")
    const q = (String(state.lastBase || state.lastLine || '').match(/[^.!?]+\?\s*$/) || [])[0];
    const sorry = R.info({ kind: 'repair' }, lang).split(/(?<=[.!?])\s/)[0];
    return out(q && state.expecting ? `${sorry} ${q.trim()}` : R.info({ kind: 'repair' }, lang));
  }
  if (!state.intent && state.phase === 'collect' && !u.intents.filter((i) => i !== 'greeting').length && !u.service && (askedElse && (u.no || /^\W*hapana\b/i.test(text)) || /\b(thank you|thanks|asante( sana)?|excited|salama kabisa|keep (it )?up|continue serving)\b/i.test(text) && state.turn > 2)) { state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true }); }
  // a name given while a callback offer is open: keep the name, drop the stale offer
  if (state.phase === 'readback' && state.pending?.tool === 'create_handoff' && u.name && !u.yes && !u.no) { mergeSlots(state, u, profile); state.pending = null; state.phase = 'collect'; if (!state.intent) return out(R.info({ kind: 'greet_name', name: nameSpeakable(state) || u.name }, lang)); const st = stepIntent(state, u, profile); if (st?.line) return out(st.line); }
  // "no" while collecting (nothing new given) ends the booking attempt honestly
  if (state.phase === 'collect' && state.intent && u.no && !u.yes && !u.service && !u.when?.date && !u.when?.time && !u.place && !u.name) { resetIntent(state); state.outcomes.push('declined'); return out(R.info({ kind: 'decline' }, lang)); }

  // 1) read-back pending: commit only on the caller's yes
  // a new question while a callback offer is open drops the offer and answers the question
  if (state.phase === 'readback' && state.pending?.tool === 'create_handoff' && !u.yes && u.intents.some((i) => INFO.includes(i))) resetIntent(state);
  if (state.phase === 'readback' && state.pending && !u.yes && !u.no && !u.done && u.intents.some((i) => INFO.includes(i))) {
    const infoKind = u.intents.find((i) => INFO.includes(i) && i !== 'want_know') || (u.intents.includes('want_know') ? 'want_know' : null);
    if (infoKind) {
      state.lastInfo = infoKind;
      if (csOn()) { const ans = infoAnswer(state, u, profile, infoKind).replace(/\s*(Anything else\?|Kuna kingine\?)$/, ''); return out(`${ans} ${propose(state, { ...state.pending })}`); }
      return out(infoAnswer(state, u, profile, infoKind));
    }
  }
  if (csOn() && state.phase === 'readback' && state.pending) { const r = await confirmSafe(state, u, profile, handlers, out, results, myTurn); if (r) return r; }
  if (state.phase === 'readback' && state.pending) {
    const p = state.pending;
    mergeSlots(state, u, profile);
    // a read-back commits only on an explicit yes; a caller repeating the time back is asked yes/no once
    if (u.done && !/^\W*(yes|ndio|ndiyo)\b/i.test(u.text) ? false : (u.yes || echoAffirms(p, u)) && !pendingChanged(p, state)) {
      p.replyText = String(u.text || '').slice(0, 160); // A4: callback read-back evidence
      if (p.tool === 'create_handoff' && p.kind === 'quote') {}
      const { rec, toolResult } = await commit(state, p, handlers);
      results.push(toolResult);
      let line = R.receipt(rec, lang);
      resetIntent(state);
      // a booking queued in the same turn as the cancel ("cancel Friday and book sofa Saturday") continues now
      if (rec.ok && p.tool === 'cancel_booking' && state.queuedBook) {
        const q = N.understand(state.queuedBook, { profile, now }); state.queuedBook = null;
        if (q.service) { state.intent = 'book'; mergeSlots(state, q, profile); const st = stepIntent(state, q, profile); if (st?.line) line = `${line.replace(/\s*(Anything else\?|Kuna kingine\?)$/, '')} ${st.line}`; }
      }
      return out(line, { ackOk: true });
    }
    if (pendingChanged(p, state)) { state.phase = 'collect'; state.pending = null; const st = stepIntent(state, u, profile); if (st?.line) return out(st.line); }
    if (u.no || u.done) { resetIntent(state); state.outcomes.push('declined'); return out(u.done ? R.info({ kind: 'bye' }, lang) : R.info({ kind: 'decline' }, lang), { end: u.done }); }
    // unrelated answer: re-read once, then hand off
    state.pendingRepeats = (state.pendingRepeats || 0) + 1;
    // not clearly yes or no and no new question: one yes/no re-ask; otherwise re-read once
    if (state.pendingRepeats <= 1 && !state.echoAsked && !u.intents.length) { state.echoAsked = true; return out(R.ask('yes_no', 0, lang, { q: (String(R.readback(p, lang) || '').match(/[^.!?]+\?\s*$/) || [''])[0].trim() })); }
    if (state.pendingRepeats <= 1) { const line = propose(state, { ...p }); return out(line); }
    state.pendingRepeats = 0;
    if (p.tool === 'create_handoff') { resetIntent(state); } else { state.phase = 'collect'; state.pending = null; }
  }

  // 2) open offers from an info answer ("would you like ...?")
  if (state.offer && !state.intent) {
    const offer = state.offer; state.offer = null;
    // HD_513dfb2fa73f: "Would you like to book?" answered with a day / place / service is a yes.
    const gaveDetail = !!(u.when?.date || u.when?.time || u.place || u.service);
    if (offer === 'book' && !u.no && !u.done && gaveDetail && !u.intents.filter((i) => i !== 'book').length) { state.intent = 'book'; state.slots.service = state.slots.service || state.offerService; mergeSlots(state, u, profile); const st = stepIntent(state, u, profile); return out(st.line); }
    if (u.yes && !u.intents.length) {
      if (offer === 'book') { state.intent = 'book'; state.slots.service = state.offerService; mergeSlots(state, u, profile); const st = stepIntent(state, u, profile); return out(st.line); }
      return out(propose(state, { tool: 'create_handoff', kind: offer === 'quote' ? 'quote' : 'callback', reason: 'callback' }));
    }
  }

  if (u.done && !state.intent) { state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true }); }

  // 3) intent
  const ni = pickIntent(u, state, profile);
  if (ni === 'cancel' && !state.intent) { const m = u.text.match(/(?:,\s*|\b(?:and|then|na|alafu|halafu)\s+|\s+(?=nataka|nahitaji|ningependa)|,(?=eka|weka))(?:book|schedule|nataka|nahitaji|ningependa|i want|i need|weka|eka)\b(.+)$/i); if (m) state.queuedBook = m[0]; }
  if (ni && ni !== state.intent && !(state.intent === 'change' && ni === 'book')) { if (state.intent) resetIntent(state); state.intent = ni; state.stateIntentTurn = state.turn; }
  // model may only propose book/order when our own reading found no intent at all
  if (!state.intent && mc && !u.intents.length) { const ok = mc.calls.find((c, i) => mc.checks[i].ok && /^(create_booking|create_order)$/.test(c.name)); if (ok && (u.service || u.products.length)) state.intent = INTENT_OF_TOOL[ok.name]; }
  // info questions answered without dropping a transaction in progress
  const infoKind = (u.intents.includes('recall') ? 'recall' : null) || u.intents.find((i) => INFO.includes(i) && i !== 'want_know') || u.intents.find((i) => i === 'want_know') || (!ni && state.lastInfo === 'price' && (u.service || u.products.length) ? 'price' : null);
  if (infoKind && (!ni || ni === 'book' && infoKind === 'availability' && !/\bbook\b/i.test(u.text) || ni === 'book' && ['coverage', 'price', 'hours', 'payment_how'].includes(infoKind) && /\?|\b(where|how much|when|wapi|ngapi|saa ngapi)\b/i.test(u.text))) {
    if (state.intent === 'book' && infoKind === 'availability' && !/\bbook|kubook\b/i.test(u.text) && state.stateIntentTurn === state.turn) state.intent = null;
    if (!state.intent || state.stateIntentTurn !== state.turn || ['coverage', 'price', 'hours', 'payment_how'].includes(infoKind)) {
      state.lastInfo = infoKind;
      if (!state.intent) mergeSlots(state, u, profile);
      const line = infoAnswer(state, u, profile, infoKind);
      // an unlisted area mid-booking: say so and offer one callback instead of pushing on (HD_db0e t18)
      if (infoKind === 'coverage' && /isn't on our list of service areas|haiko kwenye orodha ya maeneo yetu/.test(line)) { const first = line.split(/(?<=\.)\s/)[0]; return out(`${first} ${propose(state, { tool: 'create_handoff', kind: 'callback', reason: 'callback', place: u.place || null })}`); }
      // "I want sofa cleaning Friday at 10, and how much is it?": answer, then carry on with the booking
      if (!state.intent && ['price', 'hours', 'coverage', 'payment_how'].includes(infoKind) && vertical(profile) === 'home' && u.service && (u.when?.date || u.when?.time) && /\b(nataka|naomba|nahitaji|ningependa|i want|i'?d like|i need|book|kubook|ku-book)\b/i.test(u.text)) { state.intent = 'book'; state.stateIntentTurn = state.turn; }
      if (state.intent) { mergeSlots(state, u, profile); if (/\?\s*$/.test(line.replace(/\s*(Anything else\?|Kuna kingine\?)$/, ''))) return out(line); const st = stepIntent(state, u, profile); return out(st?.line ? `${line.replace(/\s*(Anything else\?|Kuna kingine\?)$/, '')} ${st.line}` : line); }
      return out(line);
    }
  }
  if (!state.intent) {
    mergeSlots(state, u, profile);
    // a service named with no question word is an enquiry about that service
    if (u.service && (!u.intents.length || u.intents.every((i) => i === 'want_know')) && vertical(profile) === 'home' && (u.when?.date || u.when?.time || /\b(next week|wiki ijayo|wiki (yenye |inayo)?(inakuja|kuja)|mashujaa|this week|wiki hii|sasa hivi|right now|leo|today|tonight)\b/i.test(u.text)) && (!/\?\s*$/.test(u.text) || (u.when?.date && u.when?.time) || /\b(can (you|someone) come|mnaweza (kuja|kufika)|(mtu|mtu wenu) anaweza kuja|kuna anayeweza kuja|kuna mtu wa kuja|mtakuja|nae?za pata|naweza kupata|can i (get|have))\b/i.test(u.text))) { state.intent = 'book'; mergeSlots(state, u, profile); const stb = stepIntent(state, u, profile); if (stb?.line) return out(stb.line); }
    if (u.service && !u.intents.length && vertical(profile) === 'home') { state.lastInfo = 'services'; mergeSlots(state, u, profile); state.offer = 'book'; state.offerService = u.service.name; const sp = spoken(profile, u.service, lang); return out(R.info({ kind: 'offered', label: sp ? sp.label : u.service.name, price: sp ? sp.price : u.service.price_range || null }, lang)); }
    // a time or a place with no intent on a home-services line means a visit
    if (AREA_ASK.test(u.text) && (u.place || u.area) && !u.intents.length) {
      state.lastInfo = 'coverage';
      return out(infoAnswer(state, u, profile, 'coverage'));
    }
    if (!u.intents.length && (u.when?.time || ((u.when?.date || u.place) && state.slots.service)) && (u.place || state.slots.service) && vertical(profile) === 'home' && !u.ack && !u.done) { state.intent = 'book'; mergeSlots(state, u, profile); const st0 = stepIntent(state, u, profile); if (st0?.line) return out(st0.line); }
    if (u.name && !u.intents.length) return out(nameSpeakable(state) ? R.info({ kind: 'greet_name', name: nameSpeakable(state) }, lang) : R.ask('intent', 0, lang));
    if (state.lastInfo === 'recall' && !u.ack) { const line = infoAnswer(state, u, profile, 'recall'); return out(line); }
    // off-catalogue item question: say plainly it isn't on our list (never guess stock or price)
    if (u.askedItem && !u.service && !u.products.length) {
      const cat = vertical(profile) === 'retail' ? (profile.productCatalog || []).map((p) => p.name) : (profile.servicesCatalog || []).map((x) => R.svcName(x.name));
      return out(R.info({ kind: 'off_catalogue', item: u.askedItem, hint: cat.slice(0, 3).join(', ') }, lang));
    }
    // acknowledgements continue from the call's own state instead of restarting
    if (u.ack) {
      state.acks = (state.acks || 0) + 1;
      if (state.acks >= 3) { state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true, endReason: 'ack_run' }); }
      return out(R.info({ kind: 'ack', service: state.slots.service }, lang));
    }
    if (u.fragment && state.turn > 1) { state.repairs = (state.repairs || 0) + 1; if (state.repairs <= 2) return out(R.info({ kind: 'repair' }, lang)); }
    const n = state.unknownCount++;
    if (n === 2 && !state.ladderOffered && !(state.callbacks || []).length) { state.ladderOffered = true; return out(propose(state, { tool: 'create_handoff', kind: 'ladder', reason: 'callback' })); }
    return out(R.ask('intent', n % 2, lang));
  }
  if (u.done && state.phase === 'collect' && state.intent !== 'complaint' && !u.intents.length) { resetIntent(state); state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true }); }
  mergeSlots(state, u, profile);
  const st = stepIntent(state, u, profile);
  if (st?.commitNow) {
    const { rec, toolResult } = await commit(state, st.commitNow, handlers);
    results.push(toolResult);
    resetIntent(state);
    return out(R.receipt(rec, lang), { ackOk: true });
  }
  return out(st?.line || R.ask('intent', 1, lang));
}

function finishCall(state, { businessName, callerPhone, profile = null } = {}) {
  const order = ['owner_only_change', 'complaint', 'booked', 'order_saved', 'moved', 'cancelled', 'handoff_callback', 'write_failed'];
  let outcome = order.find((o) => state.outcomes.includes(o));
  const s = state.slots;
  if (!outcome) outcome = state.intent && (s.service || s.items.length || s.when.date) ? 'abandoned_with_capture' : state.lastInfo ? 'answered' : 'no_action';
  const last = state.receipts[state.receipts.length - 1];
  const captured = { service: s.service || last?.service, when: (s.when.date || last?.when?.date) ? `${s.when.date || last.when.date} ${s.when.time || last?.when?.time || ''}` : null, place: s.place, items: (s.items.length ? s.items : last?.items || []).map((x) => `${x.qty || '?'} x ${x.name}`).join(', ') || null, booking: last?.row ? `${last.row.service} ${last.row.when.date}` : null };
  const intent = { booked: 'book', order_saved: 'order', moved: 'change', cancelled: 'cancel', owner_only_change: last?.kind === 'payment' ? 'payment_change' : 'address_change', complaint: 'complaint', handoff_callback: 'handoff', write_failed: INTENT_OF_TOOL[last?.tool] || 'none' }[outcome] || state.intent || state.lastInfo || 'none';
  const superseded = (state.callbacks || []).some((c) => c.supersededBy !== undefined && !c.open);
  if (superseded && outcome === 'booked') captured.note = 'earlier callback request closed: booked instead';
  const fin = { outcome, superseded: (state.callbacks || []).filter((c) => !c.open).map((c) => c.id).filter(Boolean), ownerText: renderOwnerMessage({ businessName, callerPhone, name: s.name, intent, outcome, captured }) };
  // A4 (CALL_SUMMARY_EVENT, off): typed receipts for `call.summary.ready`, built once here so the
  // C3 cached finish result (ownsCall.finish -> summaryPatch summary_receipts) carries them. Additive.
  if (require('../callSummaryEvent').callSummaryEventEnabled()) {
    fin.summaryReceipts = require('./summaryReceipts').receiptsFromV2(state, profile || {});
    fin.infoAnswered = Boolean(state.lastInfo) && !['greeting', 'who_are_you'].includes(state.lastInfo);
  }
  return fin;
}
// Catalogue/discovery step only (VOICE_V2_CATALOGUE live wiring): intent from nlu.js
// (or a checked model command), reply from receipts.js via the spoken catalogue.
// Returns null when the turn is not a catalogue turn; the caller keeps its own path.
function catalogueTurn(state, { text, profile = {}, lang, command = null, now = new Date() }) {
  state.now = now; state.lang = lang; state.turn += 1;
  const u = N.understand(text, { profile, now, expecting: null, topic: state.lastInfo });
  if (command) {
    const svc = command.service_id ? (profile.servicesCatalog || []).find((s, i) => (s.id || null) === command.service_id || SC.slug(s.name) === String(command.service_id).replace(/^svc_/, '')) || null : null;
    u.service = svc || u.service;
    u.intents = command.intent === 'explain_service' ? ['explain'] : command.intent === 'price_service' ? ['price'] : command.intent === 'list_services' ? ['services'] : command.intent === 'other' ? [] : u.intents;
  }
  let kind = null; let line = null;
  if (u.intents.includes('explain') && u.service) { kind = 'explain'; const sp = spoken(profile, u.service, lang); line = sp && sp.explain ? R.info({ kind: 'explain_text', text: sp.explain }, lang) : R.info({ kind: 'explain', name: u.service.name, notes: u.service.notes || '' }, lang); }
  else if (u.intents.includes('price') && u.service) { kind = 'price'; line = infoAnswer(state, u, profile, 'price'); }
  else if (u.intents.includes('check') && u.service) { kind = 'price'; line = checkServiceLine(profile, u.service, lang); state.offer = 'book'; state.offerService = u.service.name; }
  else if (u.intents.includes('services')) { kind = 'services'; line = infoAnswer(state, u, profile, 'services'); }
  if (line) { state.lastLine = line; state.lastInfo = kind; } else state.lastInfo = null;
  return line ? { line, kind, service: u.service?.name || null } : null;
}
// BRAIN_V2_TOPIC_PROPOSALS (default off): topic inheritance (filler / ack / barge-in keeps the
// catalogue topic for TOPIC_TTL turns), one "which service?" per turn and never twice in a row,
// and the turn's output exposed as a proposal for Voice's TurnArbiter. Off: runTurnInner as is.
const TP = require('./topic');
const TOPIC_KINDS = { services: 'catalogue', explain: 'explain', price: 'price', coverage: 'area' };
async function runTurn(state, args) {
  if (!TP.enabled()) return runTurnInner(state, args);
  const lastLine = state.lastLine || '';
  const topic = TP.liveTopic(state, state.turn + 1);
  if (topic && topic.kind === 'catalogue' && !state.offer && !state.intent && TP.inheritsTopic(args.text) && !/\b(bye|kwaheri|asante|thank)/i.test(String(args.text || ''))) {
    state.turn += 1;
    const q = TP.openQuestion(lastLine) || (L.isSw(state.lang) ? 'Ungependa ipi?' : 'Which would you like?');
    state.lastLine = q;
    state.lastBase = q;
    return { line: q, lang: state.lang, source: 'receipt', toolResults: [], end: false, proposals: [TP.proposal({ kind: 'reprompt', text: q, lang: state.lang, topic: { ...topic, now: state.turn }, claim: true })] };
  }
  const turn0 = state.turn;
  if (topic && !state.intent) {
    const doc = TP.pinDoc(state, args.profile) || SC.resolveSpokenCatalogue(args.profile || {});
    const f = require('./proposals').followUp({ text: args.text, doc, lang: L.isSw(state.lang) ? 'sw' : 'en', profile: { ...(args.profile || {}), spokenCataloguePin: { doc: doc } }, state: { v2CatalogueState: state }, topicIds: topic.itemIds });
    if (f) {
      state.lastLine = f.text; state.lastBase = f.text; state.lastInfo = f.kind === 'price' ? 'price' : 'explain';
      TP.setTopic(state, { kind: f.kind, itemIds: f.itemIds, turn: state.turn });
      const svc = f.itemIds.length === 1 ? (args.profile?.servicesCatalog || args.profile?.services || []).find((x) => x.id === f.itemIds[0]) : null;
      if (state.turn === turn0) state.turn += 1;
      if (svc) { state.offer = 'book'; state.offerService = svc.name; }
      return { line: f.text, lang: state.lang, source: 'receipt', toolResults: [], end: false, proposals: [TP.proposal({ kind: f.kind, text: f.text, lang: state.lang, topic: { ...state.topic, now: state.turn }, claim: true })] };
    }
  }
  // booking right after an explained item books that item
  if (topic && state.offerService && !state.slots.service && /\b(book|kubook|nataka|I want|I'd like)\b/i.test(String(args.text || ''))) state.slots.service = state.offerService;
  const before = JSON.stringify(state.infoRepeat || {});
  const r = await runTurnInner(state, args);
  const infoTurn = JSON.stringify(state.infoRepeat || {}) !== before;
  if (r && r.line) {
    const d = TP.dedupeQuestions(r.line, { lastLine });
    if (d && d !== r.line) { r.line = d; state.lastLine = d; }
  }
  const kind = infoTurn ? TOPIC_KINDS[state.lastInfo] || null : null;
  if (kind && r?.line && state.lastLine === r.line) TP.setTopic(state, { kind, itemIds: [], turn: state.turn });
  else if (!topic || !TP.inheritsTopic(args.text)) TP.clearTopic(state);
  if (r) r.proposals = r.line ? [TP.proposal({ kind: kind || 'turn', text: r.line, lang: state.lang, topic: kind ? { ...state.topic, now: state.turn } : null, claim: Boolean(kind) })] : [];
  return r;
}
module.exports = { createState, runTurn, finishCall, catalogueTurn };
