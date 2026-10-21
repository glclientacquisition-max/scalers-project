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
const { compileSpokenCatalogue, joinList } = require('../spokenCatalogue');
const { compileSpokenCoverage, compileSpokenPolicies } = require('../spokenFacts');
const { compileAskReceipt } = require('./askReceipt');
const { applyTicket, needsClassify, normalizeTicket } = require('./classifyAsk');
const { renderOwnerMessage } = require('./owner');
const { buildRequest } = require('./gemini');

const TRANSACTIONAL = ['payment_change', 'address_change', 'cancel', 'change', 'complaint', 'handoff', 'order', 'book'];
const INFO = ['payment_how', 'policy_returns', 'policy_deposit', 'policy_warranty', 'policy_cancel', 'greeting', 'who_are_you', 'services', 'coverage', 'recall', 'availability', 'price', 'hours', 'want_know'];
const AREA_ASK = /\b(nafika|niko|nipo|mnafika|mnakuja|mtafika|mnafikana|cover|do you cover|travel fee|delivery fee|fee to|fare|ada ya|usafiri|do you deliver|do you come)\b|\bfair\b.{0,24}\b(kuja|come|to)\b/i;
const POLICY_KEY = { policy_returns: 'returns', policy_deposit: 'deposit', policy_warranty: 'warranty', policy_cancel: 'cancellation' };
const FEE_ASK = /\b(travel fee|delivery fee|fee to|fare|ada ya|usafiri|transport|how much|ngapi|bei)\b|\bfair\b.{0,24}\b(kuja|come|to)\b/i;
const DELIVER_ASK = /\b(deliver|delivery|mnafika|come to|do you come)\b/i;

function createState({ profile = {}, callerPhone, contactName = null, openRows = [], pendingTasks = [] } = {}) {
  return {
    v: 2, turn: 0, lang: null, intent: null, phase: 'collect', expecting: null,
    slots: { service: null, when: { date: null, time: null }, place: null, name: null, items: [], row: null, new_when: { date: null, time: null }, new_place: null, kind: null, topic: null, complaint: [] },
    asked: {}, pending: null, tokenSeq: 0, lastLine: '', lastInfo: null, infoRepeat: {}, unknownCount: 0,
    callerPhone, file: { contactName, openRows: openRows.map(normRow), pendingTasks },
    staffNames: (profile.staffNames || []).map((s) => String(s).toLowerCase()),
    outcomes: [], receipts: [], trace: [], ended: false,
  };
}
function normRow(r) {
  const iso = r.window_start;
  let when = { date: null, time: null };
  if (iso) { const p = L.eatParts(new Date(iso)); when = { date: L.isoDate(p), time: `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}` }; }
  return { id: r.id, service: r.service_name, when, place: r.address_landmark, status: r.status };
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

function mergeSlots(state, u, profile) {
  const s = state.slots;
  if (u.name) {
    s.name = u.name; s.nameConfirmed = true;
    if (u.correctionOf) s.nameCorrectionOf = u.correctionOf;
  }
  if (state.intent === 'change' && /\bto\b/i.test(u.text)) {
    const after = u.text.split(/\bto\b/i).slice(1).join(' to ');
    const before = u.text.split(/\bto\b/i)[0];
    const nw = L.parseWhen(after, state.now);
    if (nw) { s.new_when = { date: nw.date || s.new_when.date, time: nw.time || s.new_when.time }; u.rowHint = before; }
  } else if (state.intent === 'change' && s.row && u.when) {
    s.new_when = { date: u.when.date || s.new_when.date, time: u.when.time || s.new_when.time };
  } else if (u.when && !['cancel', 'change', 'address_change'].includes(state.intent)) {
    if (u.when.date) s.when.date = u.when.date;
    if (u.when.time) s.when.time = u.when.time;
  }
  if (u.place && state.intent !== 'cancel') { if (state.intent === 'address_change') s.new_place = u.place; else if (s.place && !u.landmark && isArea(s.place, profile) && !isArea(u.place, profile)) { s.landmark = u.place; } // HD_513: "Simba Drive" after "Rongai" is an address note, not a new area
    else { s.landmark = u.landmark || (u.place === s.place ? s.landmark : null); s.place = u.place; } }
  if (u.service && (!s.service || !state.intent || state.phase !== 'readback')) s.service = u.service.name;
  if (u.products.length) {
    for (const p of u.products) {
      const ex = s.items.find((x) => x.product_id === p.product_id);
      if (ex) { if (p.qty) ex.qty = p.qty; } else s.items.push({ product_id: p.product_id, name: p.name, qty: p.qty });
    }
  }
  if (state.expecting === 'qty' && u.quantity) { const it = s.items.find((x) => !x.qty); if (it) it.qty = u.quantity; }
}

function resolveRow(state, u) {
  const rows = state.file.openRows.filter((r) => !/cancel|done/.test(r.status));
  if (!rows.length) return { none: true };
  const hint = u.rowHint || u.text;
  const svc = N.matchService(hint, rows.map((r) => ({ name: r.service })));
  const d = L.parseDate(hint, state.now);
  let c = rows.filter((r) => (!svc || r.service === svc.name) && (!d || r.when.date === d.date));
  if (!svc && !d) c = rows.length === 1 ? rows : [];
  if (c.length === 1) return { row: c[0] };
  return { ambiguous: (c.length ? c : rows) };
}

function askSlot(state, slot, ctx) {
  const n = state.asked[slot] || 0;
  state.asked[slot] = n + 1;
  state.expecting = slot;
  if (n >= 2 || (slot === 'name' && n >= 2)) return null; // ladder exhausted
  return R.ask(slot, n, state.lang, ctx);
}

function mint(state) { state.tokenSeq += 1; return `ct_${state.turn}x${state.tokenSeq}`; }
function propose(state, p) { p.token = mint(state); state.pending = p; state.phase = 'readback'; state.expecting = 'confirm'; return R.readback(p, state.lang); }

// Returns { line } or { ladder:true } when a slot ask is exhausted.
function stepIntent(state, u, profile) {
  const s = state.slots;
  const it = state.intent;
  if (it === 'book') {
    if (!s.service) { if (u.intents.includes('book') && !u.service && /\b(clean|usafi|kusafisha)\b/i.test(u.text) && !profile.servicesCatalog?.length) return { line: R.info({ kind: 'not_offered' }, state.lang) }; return slotOr(state, 'service'); }
    if (!s.when.date) return slotOr(state, 'date');
    if (!s.when.time) return slotOr(state, 'time', { day: L.sayDate(s.when.date, state.lang).split(' ')[0] });
    if (!s.place) return slotOr(state, 'place');
    if (!s.name && (state.asked.name || 0) < 2) return slotOr(state, 'name');
    return { line: propose(state, { tool: 'create_booking', service: s.service, when: { ...s.when }, place: s.place, landmark: s.landmark || null, name: nameSpeakable(state) }) };
  }
  if (it === 'order') {
    if (!s.items.length) return slotOr(state, 'items');
    const noQty = s.items.find((x) => !x.qty);
    if (noQty) return slotOr(state, 'qty', { item: noQty.name });
    if (!s.when.date) return slotOr(state, 'pickup');
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
  if (it === 'handoff') return { line: propose(state, { tool: 'create_handoff', kind: 'manager', reason: 'callback', topic: s.service }) };
  if (it === 'complaint') {
    s.complaint.push(u.text.slice(0, 200));
    if (s.complaint.length < 2 && !u.done) { state.expecting = 'complaint_more'; return { line: R.ask('complaint_more', 0, state.lang) }; }
    return { commitNow: { tool: 'log_complaint', category: /sofa|damag|harib/i.test(s.complaint.join(' ')) ? 'damage' : 'service_quality', summary: s.complaint.join(' / ').slice(0, 200) } };
  }
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
  // ladder step 3: offer a callback with what we captured (once per call)
  if (state.ladderOffered) { state.asked[slot] = 1; return { line: R.ask(slot, 1, state.lang, ctx) }; }
  state.ladderOffered = true;
  return { line: propose(state, { tool: 'create_handoff', kind: 'ladder', reason: 'callback', missing: slot }) };
}

async function commit(state, p, handlers) {
  const s = state.slots;
  const name = s.name || null;
  let ok = false; let result = null; let action = p.tool;
  try {
    if (p.tool === 'create_booking') {
      action = 'create_appointment';
      result = await handlers.createAppointment({ serviceName: p.service, whenText: `${p.when.date} ${p.when.time}`, windowStart: L.whenToIso(p.when), landmark: p.place, notes: p.landmark || undefined, name });
      ok = Boolean(result && (result.id || result.dryRun === true)); state.outcomes.push('booked');
    } else if (p.tool === 'create_order') {
      action = 'create_service_request';
      result = await handlers.createServiceRequest({ type: 'order', item: p.items.map((x) => `${x.qty} x ${x.name}`).join(', '), quantity: String(p.items.reduce((a, x) => a + x.qty, 0)), whenText: p.pickup.date, name, notes: p.items.map((x) => x.name).join(', ') });
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
      result = await handlers.escalate({ reason: p.reason === 'owner_only_change' ? `owner_only_change:${p.kind}` : `callback:${p.kind}`, name, captured: { place: p.place || null, booking: p.row?.id || null, missing: p.missing || null } });
      ok = Boolean(result && result.ok !== false); state.outcomes.push(p.reason === 'owner_only_change' ? 'owner_only_change' : 'handoff_callback');
    } else if (p.tool === 'log_complaint') {
      result = await handlers.escalate({ reason: `complaint:${p.category}`, name, summary: p.summary, kind: 'complaint' });
      ok = Boolean(result && result.ok !== false); state.outcomes.push('complaint');
    }
  } catch (e) { ok = false; }
  const rec = { tool: p.tool, action, ok, id: result?.id || null, service: p.service || null, when: p.when || null, items: p.items || null, pickup: p.pickup || null, row: p.row || null, kind: p.kind || null, place: p.place || null };
  state.receipts.push(rec);
  if (ok && (p.tool === 'create_booking' || p.tool === 'create_order') && s.name && handlers.saveCallerInfo) {
    const prior = state.file.contactName;
    const replace = !prior || (s.nameCorrectionOf && prior.toLowerCase() === s.nameCorrectionOf.toLowerCase());
    try { await handlers.saveCallerInfo({ name: s.name, replace }); } catch {}
  }
  if (ok && p.tool === 'cancel_booking') { const r = state.file.openRows.find((x) => x.id === p.row.id); if (r) r.status = 'cancelled'; }
  return { rec, toolResult: { action, status: ok ? 'succeeded' : 'failed', code: ok ? null : 'write_failed', v2: true } };
}

function isArea(place, profile) { return !!(N.matchArea(place, profile)?.listed || /^(Kitengela|Ruiru|Kasarani|Kilimani|Karen|Westlands|Lavington|Kileleshwa|Rongai|Syokimau|Thika|Juja|Embakasi|Langata|Ngong|Kahawa|Roysambu|Donholm|Umoja|Kikuyu|Parklands|South B|South C|Athi River|Kiambu|Nairobi)$/i.test(String(place || '').trim())); }
function resetIntent(state) {
  const keep = { name: state.slots.name, nameConfirmed: state.slots.nameConfirmed, nameCorrectionOf: state.slots.nameCorrectionOf };
  state.slots = { service: null, when: { date: null, time: null }, place: null, items: [], row: null, new_when: { date: null, time: null }, new_place: null, kind: null, topic: null, complaint: [], ...keep };
  state.intent = null; state.phase = 'collect'; state.pending = null; state.expecting = null; state.asked = { name: state.asked.name || 0 };
}

function echoAffirms(p, u) {
  if (u.negation || u.no) return false;
  if (p.tool === 'create_booking' && u.when && (u.when.time === p.when.time || u.when.date === p.when.date) && (!u.when.time || u.when.time === p.when.time) && (!u.when.date || u.when.date === p.when.date)) return true;
  return false;
}
function pendingChanged(p, state) {
  const s = state.slots;
  if (p.tool === 'create_booking') return p.service !== s.service || p.when.date !== s.when.date || p.when.time !== s.when.time || p.place !== s.place || (p.landmark || null) !== (s.landmark || null);
  if (p.tool === 'update_booking') return (s.new_when.date && s.new_when.date !== p.when.date) || (s.new_when.time && s.new_when.time !== p.when.time);
  return false;
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
    const compiled = compileSpokenCatalogue(profile, { limit: 4 });
    if (u.service) {
      const fam = compiled.familyForName(u.service.name);
      const sized = /\b(\d{1,2}|one|two|three|moja|mbili|tatu|kimoja|viwili|vitatu)\s*-?\s*(bedroom|chumba|vyumba|seater|kiti)?\b/i.test(u.text);
      if (fam?.askSize && !sized) {
        return R.info({
          kind: 'which_size',
          head: L.isSw(state.lang) ? fam.labelSw : fam.labelEn,
          sizes: compiled.sizeAsk(fam, state.lang),
        }, state.lang);
      }
      return R.info({ kind: 'offered', label: u.service.name, price: u.service.price_range || null }, state.lang);
    }
    if (u.products[0]) return R.info({ kind: 'offered', label: u.products[0].name, price: u.products[0].price ? `KSh ${u.products[0].price}` : null }, state.lang);
    if (!compiled.families.length) return R.info({ kind: 'want_know' }, state.lang);
    return R.info({ kind: 'services', names: compiled.labels(state.lang), more: compiled.more }, state.lang);
  }
  if (kind === 'coverage') {
    if (u.feeAsk || FEE_ASK.test(u.text) || (!u.area && DELIVER_ASK.test(u.text))) {
      const line = compileAskReceipt(profile, { kind: 'come_cost', place: u.area && u.area.name }, state.lang);
      if (line) return R.info({ kind: 'policy', line }, state.lang);
    }
    const loc = (profile.businessLocations || [])[0];
    const compiled = compileSpokenCoverage(profile, { limit: 4 });
    const general = compiled.names.length
      ? joinList(compiled.names, state.lang)
      : (loc?.address || profile.hoursSchedule?.location?.split('·').pop()?.trim() || null);
    return R.info({
      kind: 'coverage',
      area: u.area,
      general,
      fromList: compiled.all.length > 0,
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
    if (svc && svc.price_range && svc.pricing?.confirmed !== false) return R.info({ kind: 'price', found: true, label: svc.name, price: svc.price_range }, state.lang);
    if (prod && prod.price) return R.info({ kind: 'price', found: true, label: prod.name, price: `KSh ${prod.price}` }, state.lang);
    state.offer = 'quote';
    return R.info({ kind: 'price', found: false }, state.lang);
  }
  if (kind === 'availability') {
    const prod = u.products[0];
    if (prod) return R.info({ kind: 'stock', found: true, label: prod.name, in_stock: prod.in_stock }, state.lang, n);
    if (u.service && vertical(profile) === 'home') { state.offer = 'book'; state.offerService = u.service.name; return R.info({ kind: 'service_slot', label: u.service.name }, state.lang); }
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

async function runTurn(state, { text, profile = {}, now = new Date(), handlers, model = null, classify = null, langLock = null, acked = false }) {
  state.turn += 1; state.now = now;
  const prevLang = state.lang;
  // langLock (Voice #677): the call language is owned by Voice; never flip mid-turn.
  state.lang = (langLock === 'en' || langLock === 'sw') ? langLock : (L.nextLanguage(state.lang, text) || state.lang);
  const u = N.understand(text, { profile, now, expecting: state.expecting });
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
  const out = (line0, extra = {}) => { const line = applyAckRule(state, line0, { ackOk: !!extra.ackOk, acked: !!acked, callerAck: !!u.ack, lang }); const l = line && (line === state.lastLine || line === state.lastBase) ? (() => { const n = state.repeatN = (state.repeatN || 0) + 1; let v = R.vary(line, lang, n); if (v === state.lastLine) v = R.vary(line, lang, n, true); return v; })() : line; state.lastBase = line; state.lastLine = l; noteAck(state, l); return { line: l, lang, source: extra.source || 'receipt', toolResults: results, end: !!extra.end }; };

  // 1) read-back pending: commit only on the caller's yes
  // a new question while a callback offer is open drops the offer and answers the question
  if (state.phase === 'readback' && state.pending?.tool === 'create_handoff' && !u.yes && u.intents.some((i) => INFO.includes(i))) resetIntent(state);
  if (state.phase === 'readback' && state.pending && !u.yes && !u.no && !u.done && u.intents.some((i) => INFO.includes(i))) {
    const infoKind = u.intents.find((i) => INFO.includes(i) && i !== 'want_know') || (u.intents.includes('want_know') ? 'want_know' : null);
    if (infoKind) {
      state.lastInfo = infoKind;
      return out(infoAnswer(state, u, profile, infoKind));
    }
  }
  if (state.phase === 'readback' && state.pending) {
    const p = state.pending;
    mergeSlots(state, u, profile);
    if (u.done && !/^\W*(yes|ndio|ndiyo)\b/i.test(u.text) ? false : (u.yes || echoAffirms(p, u)) && !pendingChanged(p, state)) {
      if (p.tool === 'create_handoff' && p.kind === 'quote') {}
      const { rec, toolResult } = await commit(state, p, handlers);
      results.push(toolResult);
      const line = R.receipt(rec, lang);
      resetIntent(state);
      return out(line, { ackOk: true });
    }
    if (pendingChanged(p, state)) { state.phase = 'collect'; state.pending = null; const st = stepIntent(state, u, profile); if (st?.line) return out(st.line); }
    if (u.no || u.done) { resetIntent(state); state.outcomes.push('declined'); return out(u.done ? R.info({ kind: 'bye' }, lang) : R.info({ kind: 'decline' }, lang), { end: u.done }); }
    // unrelated answer: re-read once, then hand off
    state.pendingRepeats = (state.pendingRepeats || 0) + 1;
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
  if (ni && ni !== state.intent && !(state.intent === 'change' && ni === 'book')) { if (state.intent) resetIntent(state); state.intent = ni; state.stateIntentTurn = state.turn; }
  // model may only propose book/order when our own reading found no intent at all
  if (!state.intent && mc && !u.intents.length) { const ok = mc.calls.find((c, i) => mc.checks[i].ok && /^(create_booking|create_order)$/.test(c.name)); if (ok && (u.service || u.products.length)) state.intent = INTENT_OF_TOOL[ok.name]; }
  // info questions answered without dropping a transaction in progress
  const infoKind = (u.intents.includes('recall') ? 'recall' : null) || u.intents.find((i) => INFO.includes(i) && i !== 'want_know') || u.intents.find((i) => i === 'want_know') || (!ni && state.lastInfo === 'price' && (u.service || u.products.length) ? 'price' : null);
  if (infoKind && (!ni || ni === 'book' && infoKind === 'availability' && !/\bbook\b/i.test(u.text))) {
    if (state.intent === 'book' && infoKind === 'availability' && !/\bbook|kubook\b/i.test(u.text) && state.stateIntentTurn === state.turn) state.intent = null;
    if (!state.intent || state.stateIntentTurn !== state.turn) {
      state.lastInfo = infoKind;
      if (!state.intent) mergeSlots(state, u, profile);
      const line = infoAnswer(state, u, profile, infoKind);
      if (state.intent) mergeSlots(state, u, profile);
      return out(line);
    }
  }
  if (!state.intent) {
    mergeSlots(state, u, profile);
    // a service named with no question word is an enquiry about that service
    if (u.service && !u.intents.length && vertical(profile) === 'home') { state.lastInfo = 'services'; mergeSlots(state, u, profile); state.offer = 'book'; state.offerService = u.service.name; return out(R.info({ kind: 'offered', label: u.service.name, price: u.service.price_range || null }, lang)); }
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
      if (state.acks >= 3) { state.ended = true; return out(R.info({ kind: 'bye' }, lang), { end: true }); }
      return out(R.info({ kind: 'ack', service: state.slots.service }, lang));
    }
    if (u.fragment && state.turn > 1) { state.repairs = (state.repairs || 0) + 1; if (state.repairs <= 2) return out(R.info({ kind: 'repair' }, lang)); }
    const n = state.unknownCount++;
    if (n === 2 && !state.ladderOffered) { state.ladderOffered = true; return out(propose(state, { tool: 'create_handoff', kind: 'ladder', reason: 'callback' })); }
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
  const order = ['owner_only_change', 'complaint', 'booked', 'order_saved', 'moved', 'cancelled', 'handoff_callback'];
  let outcome = order.find((o) => state.outcomes.includes(o));
  const s = state.slots;
  if (!outcome) outcome = state.intent && (s.service || s.items.length || s.when.date) ? 'abandoned_with_capture' : state.lastInfo ? 'answered' : 'no_action';
  const last = state.receipts[state.receipts.length - 1];
  const captured = { service: s.service || last?.service, when: (s.when.date || last?.when?.date) ? `${s.when.date || last.when.date} ${s.when.time || last?.when?.time || ''}` : null, place: s.place, items: (s.items.length ? s.items : last?.items || []).map((x) => `${x.qty || '?'} x ${x.name}`).join(', ') || null, booking: last?.row ? `${last.row.service} ${last.row.when.date}` : null };
  const intent = { booked: 'book', order_saved: 'order', moved: 'change', cancelled: 'cancel', owner_only_change: last?.kind === 'payment' ? 'payment_change' : 'address_change', complaint: 'complaint', handoff_callback: 'handoff' }[outcome] || state.intent || state.lastInfo || 'none';
  // A4: typed receipts for `call.summary.ready` (callSummaryEvent.js). Additive.
  const summaryReceipts = require('./summaryReceipts').receiptsFromV2(state, profile || {});
  return { outcome, ownerText: renderOwnerMessage({ businessName, callerPhone, name: s.name, intent, outcome, captured }), summaryReceipts, infoAnswered: Boolean(state.lastInfo) && !['greeting', 'who_are_you'].includes(state.lastInfo) };
}
module.exports = { createState, runTurn, finishCall };
