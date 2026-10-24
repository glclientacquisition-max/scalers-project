'use strict';
// BRAIN_V1_DRAFT_PHASE_B (off|on; needs BRAIN_V1_DRAFT=on + BRAIN_V1_DRAFT_PHASE_A=on; Done & Dusted only).
// Design: ship-briefs/2026-10-24_brain_single-brain-phase-b-design.md (Alvin t315u/t316u).
// ONE call plan, owned by v2, guides the caller through the call:
//   items   - what the caller asked for: ONE booking holds 1..N services (line items). "add carpet" appends an
//             item before the read-back (one read-back, one yes, one write with services[]), or after a write
//             runs add_service on the existing booking (idempotent per item; Alvin t320u).
//   settled - date/time/place and the name (locked name only; name lock stays in code)
//   step    - the ONE next thing to say/ask (ask a slot | confirm a saved name | read back | confirmed | open)
// The model speaks every turn; it phrases the step. actCheck() gates each sentence before TTS:
// at most one question, the question must be the step's question, a read-back must carry the exact plan.
// Anything else falls back to the step's template line. Caller-facing lines: [PROMPT-PLACEHOLDER].
const R = require('./receipts');
const L = require('./lexicon');
const V1 = require('./v1draft');
const CS = require('./commitSafety');
const crypto = require('crypto');

function phaseB({ env = process.env, tenantId } = {}) {
  return V1.phaseA({ env, tenantId }) && String(env.BRAIN_V1_DRAFT_PHASE_B || 'off').trim().toLowerCase() === 'on';
}

const ADD = /\b(add|also|as well|plus|on top|together with|another|in addition|ongeza|ongezea|pia|pamoja na|na pia)\b/i;
const SWITCH = /\b(instead|change (it|that|the service|the booking)? ?to|switch (it |that )?to|rather|badala ya|badilisha)\b/i;
const HAVE_NAME = /\b(you (have|got|know|already have) my name|have my name|mna jina langu|mnajua jina langu|mnalo jina langu|jina langu mnalo)\b/i;
const YES = /^\W*(yes|yeah|yep|sure|correct|right|that'?s (me|right)|ndio|ndiyo|sawa|eeh|ni mimi|ni sahihi)\b/i;
const NO = /^\W*(no|nope|hapana|si mimi|sio)\b/i;
const GENERIC = new Set(['cleaning', 'clean', 'service', 'standard', 'internal', 'interior', 'deep', 'package', 'per', 'room', 'seat', 'the', 'and', 'add', 'on']);
// Swahili words callers use for catalogue services (code-switch: "ongeza usafi wa zulia")
const SW_SVC = { zulia: 'carpet', mazulia: 'carpet', dirisha: 'window', madirisha: 'window', kochi: 'sofa', makochi: 'sofa', godoro: 'mattress', magodoro: 'mattress', friji: 'refrigerator', jiko: 'oven', ofisi: 'office' };
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const sw = (lang) => L.isSw(lang);

function matchServices(text, profile = {}) {
  const w = words(text).map((x) => SW_SVC[x] || x);
  const has = (k) => w.includes(k) || w.includes(`${k}s`);
  return (profile.servicesCatalog || []).filter((s) => { const k = words(s.name).filter((x) => x.length >= 4 && !GENERIC.has(x) && !/^\d/.test(x)); return k.length && k.some(has); });
}

function plan(state) {
  const p = state.plan || (state.plan = { items: [], nameAsk: null, trace: [] });
  const svc = state.slots && state.slots.service;
  if (svc && !p.items.length) p.items.push({ service: svc, turn: state.turn });
  if (svc && p.items.length && p.items[0].service !== svc && !p.pinned) p.items[0] = { service: svc, turn: state.turn };
  return p;
}
const lockedName = (state) => (state.slots && state.slots.nameConfirmed && state.slots.name) || (state.file && state.file.nameConfirmed && !state.file.sharedLine && state.file.contactName) || null;
const savedCandidate = (state) => (!lockedName(state) && state.file && !state.file.sharedLine && state.file.contactName) || null;

function itemsSaid(items, lang) {
  const n = items.map((it, i) => { const s = R.svcName(it.service, lang); return i && !sw(lang) ? s.toLowerCase() : s; });
  return n.length <= 1 ? (n[0] || '') : `${n.slice(0, -1).join(', ')} ${sw(lang) ? 'na' : 'and'} ${n[n.length - 1]}`;
}
function readbackLine(state, lang) {
  const pd = state.pending; const p = plan(state);
  if (!pd || pd.tool !== 'create_booking') return null;
  const base = R.readback(pd, lang);
  if (p.items.length <= 1) return base;
  const one = R.svcName(pd.service, lang);
  return base.includes(one) ? base.replace(one, itemsSaid(p.items, lang)) : base;
}

/**
 * Before v2's machine runs this turn. May own the turn (returns {owned:true,line}) or rewrite the text the
 * machine reads (a confirmed saved name becomes the name answer). Never speaks.
 */
async function before(state, text, profile = {}, { handlers = null } = {}) {
  const p = plan(state); const lang = state.lang || 'en'; const t = String(text || '');
  const out = { owned: false, text: t, acts: [] };
  const own = (line, act) => { state.turn += 1; state.lastLine = line; state.lastBase = line; if (act) out.acts.push(act); (state.trace || (state.trace = [])).push({ turn: state.turn, call_plan: act }); return { ...out, owned: true, line, lang }; };
  // 0) an open add-service read-back on an existing booking: one yes -> add_service per item (idempotent)
  if (state.pending && state.pending.tool === 'add_service') {
    const pd = state.pending;
    if (YES.test(t) && !NO.test(t)) {
      const added = [];
      for (const svc of pd.services) {
        let r = null; try { r = handlers && handlers.addAppointmentService ? await handlers.addAppointmentService({ appointmentId: pd.row.id, serviceName: svc, idempotencyKey: `${pd.row.id}#+${svc.toLowerCase()}` }) : null; } catch { r = null; }
        const ok = !!(r && r.ok !== false && (r.id || r.duplicate));
        state.receipts.push({ tool: 'add_service', action: 'add_appointment_service', ok, id: ok ? (r.id || pd.row.id) : null, service: svc, appointmentId: pd.row.id, duplicate: !!(r && r.duplicate) });
        if (ok) { added.push(svc); if (!pd.row.items.includes(svc)) pd.row.items.push(svc); }
      }
      state.pending = null; state.phase = 'collect'; state.expecting = null;
      if (added.length) { for (const a of added) if (!p.items.some((i) => i.service === a)) p.items.push({ service: a, turn: state.turn + 1, added: true, written: true }); state.outcomes.push('service_added'); }
      const names = itemsSaid(added.map((x) => ({ service: x })), lang);
      const allOk = added.length === pd.services.length;
      return own(allOk
        ? (sw(lang) ? `Sawa, nimeongeza ${names} kwenye booking yako. Kuna kingine?` : `Done, ${names} is added to your booking. Anything else?`) /* [PROMPT-PLACEHOLDER] */
        : (sw(lang) ? 'Samahani, sikuweza kuongeza hiyo sasa. Timu itakupigia kuthibitisha.' : "Sorry, I couldn't add that just now. The team will call you to sort it out.") /* [PROMPT-PLACEHOLDER] */, allOk ? 'service_added' : 'service_add_failed');
    }
    if (NO.test(t)) { state.pending = null; state.phase = 'collect'; state.expecting = null; return own(sw(lang) ? 'Sawa, nimeacha booking kama ilivyo. Kuna kingine?' : "Okay, I'll leave the booking as it is. Anything else?" /* [PROMPT-PLACEHOLDER] */, 'service_add_declined'); }
  }
  // 1) items: an add appends an item (in collect or at the read-back)
  const rows = matchServices(t, profile).filter((r) => !p.items.some((i) => i.service === r.name));
  if (rows.length && p.items.length && ADD.test(t) && !SWITCH.test(t)) {
    for (const r of rows) p.items.push({ service: r.name, turn: state.turn + 1, added: true });
    p.pinned = true; out.acts.push('item_added');
    if (state.phase === 'readback' && state.pending && state.pending.tool === 'create_booking') {
      setPendingItems(state, p);
      const line = readbackLine(state, lang); state.pending.readbackLine = line; state.pending.issuedTurn = state.turn + 1; state.expecting = 'confirm';
      return own(line, 'item_added_readback');
    }
  }
  // 1b) add on an EXISTING booking (written earlier this call, or the caller's one open booking on file)
  const booked = existingBooking(state);
  const addRows = matchServices(t, profile);
  if (booked && !state.pending && addRows.length && ADD.test(t) && !SWITCH.test(t)) {
    const services = addRows.map((r) => r.name).filter((n) => !booked.items.includes(n));
    if (services.length) {
      state.pending = { tool: 'add_service', row: booked, services, token: `add_${booked.id}_${state.turn + 1}` };
      state.phase = 'readback'; state.expecting = 'confirm';
      const what = itemsSaid(services.map((x) => ({ service: x })), lang); const on = itemsSaid(booked.items.map((x) => ({ service: x })), lang);
      const line = sw(lang) ? `Niongeze ${what} kwenye booking yako ya ${on}${booked.when ? `, ${L.sayDate(booked.when.date, lang)}` : ''}?` : `Shall I add ${what} to your ${on.toLowerCase()} booking${booked.when ? ` on ${L.sayDate(booked.when.date, lang)}` : ''}?`; /* [PROMPT-PLACEHOLDER] */
      state.pending.readbackLine = line;
      return own(line, 'add_service_readback');
    }
  }
  // 2) name: confirm a saved (unconfirmed) name instead of asking it cold; "you have my name" is a check, not a non-answer
  const cand = savedCandidate(state);
  if (state.expecting === 'name') {
    if (p.nameAsk === 'confirm' && cand && YES.test(t)) { p.nameAsk = null; out.text = cand; out.acts.push('saved_name_confirmed'); return out; }
    if (p.nameAsk === 'confirm' && NO.test(t)) { p.nameAsk = 'ask'; state.turn += 1; const line = sw(lang) ? 'Sawa. Naomba jina lako?' : 'Okay. May I have your name?'; /* [PROMPT-PLACEHOLDER] */ state.lastLine = line; return { ...out, owned: true, line, lang }; }
    if (HAVE_NAME.test(t)) {
      state.turn += 1; out.acts.push('have_my_name');
      if (cand) { p.nameAsk = 'confirm'; const line = sw(lang) ? `Nina jina ${cand} kwenye rekodi. Ni wewe?` : `I have ${cand} on file. Is that you?`; /* [PROMPT-PLACEHOLDER] */ state.lastLine = line; return { ...out, owned: true, line, lang }; }
      const line = sw(lang) ? 'Sina jina lako kwenye rekodi bado. Naomba jina lako?' : "I don't have your name on file yet. May I have it?"; /* [PROMPT-PLACEHOLDER] */
      state.lastLine = line; return { ...out, owned: true, line, lang };
    }
  }
  return out;
}

/** After the machine: keep the plan's items (the machine replaces s.service), read back every item. */
function after(state, res, { lang } = {}) {
  const p = plan(state); let line = String(res.line || '');
  if (p.pinned && p.items.length && state.slots.service !== p.items[0].service) state.slots.service = p.items[0].service;
  if (state.pending && state.pending.tool === 'create_booking') {
    if (p.pinned && state.pending.service !== p.items[0].service) state.pending.service = p.items[0].service;
    if (p.items.length > 1) {
      const old = state.pending.readbackLine; setPendingItems(state, p); const nl = readbackLine(state, lang || state.lang);
      state.pending.readbackLine = nl;
      if (old && line.includes(old)) line = line.replace(old, nl); else if (state.phase === 'readback' && line && !line.includes(nl)) line = nl;
    }
  }
  // a saved-but-unconfirmed name: the name question becomes "is it X?" (the caller still says it; code binds it)
  const cand = savedCandidate(state);
  if (state.expecting === 'name' && cand && !p.nameAsk && /\?\s*$/.test(line)) {
    p.nameAsk = 'confirm';
    line = line.replace(/[^.!?]*\?\s*$/, sw(lang) ? `Niweke kwa jina ${cand}?` : `Shall I put it under ${cand}?`); /* [PROMPT-PLACEHOLDER] */
  }
  return line;
}

/** The pending booking carries the item list; the idempotency key covers the items (one write for N services). */
function setPendingItems(state, p) {
  const pd = state.pending; if (!pd) return;
  pd.items = p.items.map((i) => i.service);
  const h = crypto.createHash('sha256').update(pd.items.join('|').toLowerCase()).digest('hex').slice(0, 8);
  pd.idemKey = `${CS.idempotencyKey({ callId: state.callId, p: pd })}:items_${h}`;
}
/** An open booking this caller already has: written this call, else the one open row on file. */
function existingBooking(state) {
  const rec = [...(state.receipts || [])].reverse().find((r) => r.tool === 'create_booking' && r.ok && r.id);
  if (rec) return { id: rec.id, items: rec.items ? [...rec.items] : [rec.service], when: rec.when || null };
  const rows = (state.file && state.file.openRows || []).filter((r) => r && r.id && (r.service_name || r.service));
  if (rows.length === 1) return { id: rows[0].id, items: String(rows[0].service_name || rows[0].service).split(' + '), when: null };
  return null;
}

const SLOT_Q = {
  place: /\b(where|place|area|location|address|estate|wapi|mahali|eneo)\b/i,
  name: /\b(name|under|jina)\b/i,
  date: /\b(day|date|when|which day|lini|siku|tarehe)\b/i,
  time: /\b(time|what time|o'?clock|saa|muda)\b/i,
  service: /\b(service|which|what|huduma|gani)\b/i,
  confirm: /\b(book|confirm|go ahead|shall i|add|nithibitishe|niendelee|ni sawa|niongeze|ongeze)\b/i,
};
const isQ = (s) => /\?\s*$/.test(String(s || '').trim());

/** The one step this turn speaks, from the plan (after the machine ran). */
function step(state, templateLine, lang) {
  const p = plan(state); const q = (String(templateLine || '').match(/[^.!?]*\?\s*$/) || [''])[0].trim() || null;
  const base = { items: p.items.map((i) => i.service), name: lockedName(state), when: state.slots.when || null, place: state.slots.place || null, template: templateLine, question: q, lang };
  const rec = [...(state.receipts || [])].reverse().find((r) => r.ok && r.id && r.tool === 'create_booking');
  if (state.phase === 'readback' && state.pending && state.pending.tool === 'add_service') return { ...base, kind: 'add_service', question: state.pending.readbackLine, slot: 'confirm', items: [...state.pending.row.items, ...state.pending.services] };
  if ((state.outcomes || []).slice(-1)[0] === 'service_added') return { ...base, kind: 'confirmed', writeIds: (state.receipts || []).filter((r) => r.tool === 'add_service' && r.ok).map((r) => r.id) };
  if (state.phase === 'readback' && state.pending) return { ...base, kind: 'readback', readback: state.pending.readbackLine || readbackLine(state, lang), slot: 'confirm' };
  if (rec && (state.outcomes || []).slice(-1)[0] === 'booked') return { ...base, kind: 'confirmed', writeIds: [rec.id] };
  if (state.expecting) return { ...base, kind: p.nameAsk === 'confirm' && state.expecting === 'name' ? 'confirm_name' : 'ask', slot: state.expecting };
  return { ...base, kind: 'open' };
}
/** What the model is told (user turn, not the cached prefix). */
function stepNote(st) {
  return `PLAN (system-owned; do not change it): ${JSON.stringify({ items: st.items, name: st.name, when: st.when, place: st.place, step: st.kind, slot: st.slot || null })}\n`
    + `STEP: first answer what the caller just said or asked (FACTS only), then ${st.kind === 'readback' ? `read back exactly: "${st.readback}"` : st.question ? `ask exactly one question with the same meaning as: "${st.question}"` : 'ask at most one question'}. Never more than one question.`;
}

/**
 * Gate one model sentence against the step (after the KB verifier passed it).
 * Returns { verdict:'pass'|'drop'|'replace', text, reason }.
 */
function actCheck(text, st, ctx) {
  const s = String(text || '').trim();
  if (!isQ(s)) {
    if (/\b(booked|confirmed|added|nimekuwekea|imethibitishwa|nimeongeza)\b/i.test(s) && st.kind !== 'confirmed') return { verdict: 'drop', reason: 'claims_write' };
    return { verdict: 'pass', text: s };
  }
  if (ctx.questions >= 1) return { verdict: 'drop', reason: 'second_question' };
  if (st.kind === 'readback') {
    const low = s.toLowerCase();
    const must = [...st.items.map((i) => words(R.svcName(i, st.lang)).filter((w) => w.length >= 4 && !GENERIC.has(w))[0] || words(i)[0]), st.place, st.name].filter(Boolean).map((x) => String(x).toLowerCase());
    const dateOk = !st.when || !st.when.date || low.includes(String(L.sayDate(st.when.date, st.lang)).toLowerCase().split(/[ ,]/)[0]);
    if (must.every((m) => low.includes(m)) && dateOk) return { verdict: 'pass', text: s };
    return { verdict: 'replace', text: st.readback, reason: 'readback_mismatch' };
  }
  if (st.slot && SLOT_Q[st.slot] && st.question) return SLOT_Q[st.slot].test(s) ? { verdict: 'pass', text: s } : { verdict: 'replace', text: st.question, reason: `off_step:${st.slot}` };
  if (st.kind === 'confirm_name' && st.question) return /\b(name|under|jina|you)\b/i.test(s) ? { verdict: 'pass', text: s } : { verdict: 'replace', text: st.question, reason: 'off_step:confirm_name' };
  return { verdict: 'pass', text: s };
}
/** The step's own sentence when the model spoke no (valid) step sentence. */
function tail(st) { if (st.kind === 'readback') return st.readback; return st.question; }

const split = (line) => String(line || '').match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [];
module.exports = { existingBooking, setPendingItems, split, phaseB, plan, before, after, step, stepNote, actCheck, tail, readbackLine, matchServices, lockedName, ADD, SWITCH, HAVE_NAME };
