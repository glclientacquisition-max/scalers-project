'use strict';
// BRAIN_MODEL_LEAD (off|on; Done & Dusted only via BRAIN_V1_DRAFT_TENANTS; needs BRAIN_V1_DRAFT=on + PHASE_A=on).
// Spec: ship-briefs/2026-10-25_brain_model-led-call-core-spec.md (Alvin GO 2026-10-25 09:50 EAT, decisions 1-5 YES).
// "The model leads, code guards." ONE structured model call per turn returns {understanding, tool_calls, reply}.
// Code owns state (the v2 machine: name lock, dates, catalogue, writes), runs read-only tools BEFORE the model
// (caller file, per-place coverage, KB) so most turns are one call, and checks every reply sentence against
// receipts/KB/state. Fixed wording only for the read-back and the booked line; templates only when every model fails.
// Off = byte-for-byte the #932 path (liveTurn never enters this module).
// Caller-facing lines in this file: [PROMPT-PLACEHOLDER] (Prompt lane owns the copy).
const V1 = require('./v1draft');
const AC = require('./areaCoverage');
const AP = require('./areaPicks');
const CP = require('./callPlan');
const CC = require('./callCore');
const L = require('./lexicon');
const { hoursFact } = require('./v1draftFacts');

function leadOn({ env = process.env, tenantId } = {}) {
  return V1.phaseA({ env, tenantId }) && String(env.BRAIN_MODEL_LEAD || 'off').trim().toLowerCase() === 'on';
}

// One place for every deadline (replaces v1draft r2FirstByMs 2600 on this path). Decision 2 + 3.
const DEADLINES = { hedgeMs: 900, hardMs: 1800, repairMinLeftMs: 300, repairCapMs: 450, understandWaitMs: 1500 };
// Split path (BRAIN_MODEL_LEAD_SPLIT, default on under BRAIN_MODEL_LEAD): understanding and reply are two parallel calls.
// Join rule: the state machine runs when the understanding arrives OR the reply's first sentence is ready OR
// understandCapMs passes, whichever is first. A late understanding is never discarded: it still adds owed answers
// (questions/places) before the turn ends and is carried to the next turn (machine.leadLateU).
const SPLIT_DEADLINES = { hedgeMs: 700, hardMs: 1800, repairMinLeftMs: 300, repairCapMs: 450, understandHedgeMs: 600, understandCapMs: 1100 };
function splitOn({ env = process.env } = {}) { return String(env.BRAIN_MODEL_LEAD_SPLIT || 'on').trim().toLowerCase() !== 'off'; }
/** Lead-path models (configurable): flash-lite primary (staging TTFT ~650-800 ms), 3.6-flash hedge backup. */
function leadModels(env = process.env) {
  return { primary: String(env.BRAIN_LEAD_MODEL_ID || '').trim() || 'gemini-3.5-flash-lite', backup: String(env.BRAIN_LEAD_BACKUP_MODEL_ID || '').trim() || 'gemini-3.6-flash' };
}
const UPCOMING_MAX = 3; // Alvin decision 3 (2026-10-25): only upcoming open bookings, max 3
const sw = (lang) => L.isSw(lang);

// ---------------------------------------------------------------- receipts (read-only tools, run in code)

/** lookup_caller receipt from the caller file the call already loaded (callerMemory -> machine.file). */
function callerReceipt(file = {}, { now = new Date(), lockedName = null } = {}) {
  const t = now.getTime();
  const rows = (file.openRows || []).filter(Boolean);
  const startOf = (r) => { const iso = r.window_start || r.windowStart; if (iso) return Date.parse(iso); if (r.when && r.when.date) return Date.parse(`${r.when.date}T${r.when.time || '23:59'}:00+03:00`); return NaN; };
  const closed = (r) => /^(cancel|done|complete|closed|no_show)/i.test(String(r.status || ''));
  const svc = (r) => r.service_name || r.service || r.job || r.item || null;
  const isPast = (r) => r.past === true || (Number.isFinite(startOf(r)) && startOf(r) < t);
  const upcomingAll = rows.filter((r) => (r.kind || 'visit') === 'visit' && svc(r) && !closed(r) && !isPast(r))
    .sort((a, b) => (startOf(a) || Infinity) - (startOf(b) || Infinity));
  const past = rows.filter((r) => svc(r) && isPast(r)).sort((a, b) => startOf(b) - startOf(a));
  const lv = file.lastVisit && svc(file.lastVisit) ? file.lastVisit : null;
  const lastPast = [past[0], lv].filter(Boolean).sort((a, b) => (startOf(b) || 0) - (startOf(a) || 0))[0] || null;
  const day = (r) => { const s = startOf(r); return Number.isFinite(s) ? L.isoDate(L.eatParts(new Date(s))) : (r.whenText || r.when_text || null); };
  const shape = (r) => ({ id: r.id || null, service: svc(r), date: day(r), place: r.address_landmark || r.place || null, status: r.status || null });
  const name = lockedName || (file.nameConfirmed && !file.sharedLine ? file.contactName || null : null);
  return {
    tool: 'lookup_caller', ok: true,
    name, name_confirmed: !!name,
    candidate: !name && !file.sharedLine ? file.contactName || null : null,
    last_past_job: lastPast ? shape(lastPast) : null,
    upcoming: upcomingAll.slice(0, UPCOMING_MAX).map(shape),
    upcoming_count: upcomingAll.length,
  };
}

/** Place names the CALLER named (AC.placeMentions: the model's places confirmed in the caller's words, plus exact/landmark
 * names inside an explicit place slot). Never fuzzy-invents a place from free text (rogue calls HD_7a9915837b00 / HD_ef5ee3a15a0a). */
function placeCandidates(text, opts = {}) { return AC.placeMentions(text, opts).map((m) => m.name); }
/** Strict place names in a MODEL sentence (exact/alias/landmark, whole words, stop-listed; never fuzzy). Guard use only. */
function scanPlaces(words) {
  const out = []; let i = 0;
  while (i < words.length) {
    let hit = null;
    for (let n = Math.min(3, words.length - i); n >= 1 && !hit; n -= 1) {
      const w = words.slice(i, i + n); const q = norm(w.join(' '));
      if (AC.PLACE_STOP.has(norm(w[0])) || AC.PLACE_STOP.has(norm(w[w.length - 1])) || (n === 1 && w[0].length < 4)) continue;
      const m = AC.treeMatch(q, { fuzzy: false });
      if (m && m.node && !m.fuzzy && m.said === q) hit = { name: m.node.name, n }; // whole span, never a fuzzy hit (the old m.said self-compare let fuzzy through)
    }
    if (hit) { if (!out.includes(hit.name)) out.push(hit.name); i += hit.n; } else i += 1;
  }
  return out;
}
const norm = (x) => String(x).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/** Canonical place names in text (full tree name or alias), same rules as scanPlaces. */
function placesNamedInText(text) {
  const words = String(text || '').replace(/[?.!;:",]/g, ' ').split(/\s+/).filter(Boolean);
  return scanPlaces(words);
}

/** Places the caller has named earlier on this call (slots, receipts, memory). */
function callerAllowedPlaces(ctx) {
  const out = new Set();
  const add = (p) => { if (p) out.add(String(p).toLowerCase()); };
  for (const r of ctx.coverage || []) if (r.from === 'caller') add(r.place);
  for (const p of (ctx.machine && ctx.machine.callerPlaces) || []) add(p);
  if (ctx.machine && ctx.machine.slots && ctx.machine.slots.place) {
    const res = AC.resolve(ctx.machine.slots.place, ctx.profile || {});
    add(res && res.name ? res.name : ctx.machine.slots.place);
  }
  return out;
}

/** Remember caller-named places for later turns (guard unasked_place). */
function rememberCallerPlaces(machine, { coverage, text, profile, u } = {}) {
  const names = new Set(machine.callerPlaces || []);
  for (const r of (coverage && coverage.places) || []) if (r.from === 'caller') names.add(r.place);
  for (const p of placesNamedInText(text)) names.add(p);
  if (u && u.slots && Array.isArray(u.slots.places)) {
    for (const raw of u.slots.places) {
      const hit = placeCandidates(text, { u: { slots: { places: [raw] } } })[0];
      if (hit) {
        const rec = coverageReceipt([hit], profile).places[0];
        if (rec) names.add(rec.place);
      }
    }
  }
  if (machine.slots && machine.slots.place) {
    const res = AC.resolve(machine.slots.place, profile || {});
    names.add((res && res.name) || machine.slots.place);
  }
  machine.callerPlaces = [...names].slice(0, 12);
}

/** The owner's area note on a receipt row: a checkable owner fact (verbatim), with its language. */
const noteFields = (r) => (r && r.status === 'covered' && r.note ? { note: r.note, note_lang: r.note_lang || null } : { note: null, note_lang: null });
/** check_coverage receipt: one row per place (1..5). Picks resolver per place; legacy only when no picks. */
function coverageReceipt(places = [], profile = {}) {
  const rows = [];
  for (const raw of places.slice(0, 5)) {
    const p = String(raw || '').trim(); if (!p) continue;
    const r = AC.resolve(p, profile) || AC.resolve(p.replace(/\b[a-z]/g, (c) => c.toUpperCase()), profile);
    const name = r && r.name ? r.name : p.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    if (rows.some((x) => x.place.toLowerCase() === name.toLowerCase())) continue;
    const covered = !r || r.status === 'unknown' ? 'unknown' : r.status === 'covered' ? 'yes' : 'no';
    rows.push({ place: name, said: p, matched_node: r && r.node || null, covered, status: r ? r.status : 'unknown', source: r && r.source === 'picks' ? 'area_picks' : 'legacy', line_en: r ? AC.line(r, 'en') : null, line_sw: r ? AC.line(r, 'sw') : null, via: r && r.via || null, fee_kes: r && r.fee_kes != null ? r.fee_kes : null, ...noteFields(r) });
  }
  return { tool: 'check_coverage', ok: true, places: rows };
}

/** Every place the CALLER named, resolved on the ONE coverage source (confirmed picks; legacy rows only with no picks).
 * opts: { u (understanding, may be null), expecting }. Rows carry from:'caller'. An unknown "do you cover X?" with no
 * tree match stays the honest "which area is that near?" row. */
function coverageFor(text, profile = {}, opts = {}) {
  const rejected = [];
  const rec = coverageReceipt(placeCandidates(text, { ...opts, rejected }), profile);
  if (!rec.places.length) {
    const r = AC.resolve(String(text || ''), profile, { expecting: opts.expecting });
    if (r && r.name) rec.places.push({ place: r.name, said: r.landmark || r.name, matched_node: r.node || null, covered: r.status === 'covered' ? 'yes' : r.status === 'unknown' ? 'unknown' : 'no', status: r.status, source: r.source === 'picks' ? 'area_picks' : 'legacy', via: r.via || null, line_en: AC.line(r, 'en'), line_sw: AC.line(r, 'sw'), fee_kes: r.fee_kes ?? null, ...noteFields(r) });
  }
  for (const r of rec.places) r.from = 'caller';
  if (rejected.length) rec.rejected = rejected;
  return rec;
}
/** Model-heard places (arriving after the prefetch) join the turn's rows only when the caller said them. */
function addCallerPlaces(coverage, u, text, profile = {}, machine = {}) {
  if (!u || !u.slots || !Array.isArray(u.slots.places) || !u.slots.places.length) return coverage;
  const rec = coverageFor(text, profile, { u, expecting: machine.expecting });
  for (const r of rec.places) if (!coverage.places.some((x) => x.place.toLowerCase() === r.place.toLowerCase())) coverage.places.push(r);
  if (rec.rejected) coverage.rejected = [...new Set([...(coverage.rejected || []), ...rec.rejected])];
  return coverage;
}
/** A place the caller named with no answer yet is owed a coverage answer. Only caller rows (never guard/model rows). */
function owedCoverageQuestion(questions, coverage, text, machine = {}) {
  const said = coverage.filter((r) => r.from === 'caller');
  if (!said.length || questions.some((q) => q.type === 'coverage')) return questions;
  if (['landmark', 'name'].includes(machine.expecting)) return questions;
  questions.push({ type: 'coverage', subject: said.map((r) => r.place).join(', '), why: RF.placeStatement(text) ? 'place_statement' : 'place_mention' });
  return questions;
}
/** One honest coverage sentence per place, never stacked ([PROMPT-PLACEHOLDER]). */
function coverageSentence(row, lang) {
  if (row.covered === 'unknown' && (row.line_en || row.line_sw)) return sw(lang) ? row.line_sw : row.line_en; // "which area is that near?" / "the team will confirm"
  if (row.covered !== 'unknown') return (sw(lang) ? row.line_sw : row.line_en) || (row.covered === 'yes' ? (sw(lang) ? `Ndio, tunafika ${row.place}.` : `Yes, we cover ${row.place}.`) : (sw(lang) ? `Samahani, hatufiki ${row.place}.` : `Sorry, we don't cover ${row.place}.`));
  return sw(lang) ? `Sina uhakika kuhusu ${row.place}; timu inaweza kuthibitisha.` : `I'm not sure about ${row.place}; I can have the team confirm.`;
}
function coverageAnswer(rows, lang) {
  if (!rows.length) return null;
  const yes = rows.filter((r) => r.covered === 'yes'); const no = rows.filter((r) => r.covered === 'no'); const unk = rows.filter((r) => r.covered === 'unknown');
  const join = (a) => a.map((r) => r.place).join(sw(lang) ? ' na ' : ' and ');
  if (rows.length === 1) return coverageSentence(rows[0], lang);
  const parts = [];
  if (yes.length) parts.push(sw(lang) ? `Ndio, tunafika ${join(yes)}.` : `Yes, we cover ${join(yes)}.`);
  if (no.length) parts.push(sw(lang) ? `Hatufiki ${join(no)}.` : `We don't cover ${join(no)}.`);
  for (const u of unk) parts.push(coverageSentence(u, lang));
  return parts.join(' ');
}

const RF = require('./replyFacts');
const OF = require('./ownerFacts'); // B1: the one owner-fact projection

/** KB slice the model may quote (prices only reach the caller when asked: G8). */
function kb(profile = {}) {
  const services = (profile.servicesCatalog || []).slice(0, 40).map((s) => ({ id: s.id, name: s.name, price: s.pricing?.confirmed === false ? null : s.price_range || null }));
  const h = hoursFact(profile);
  // owner policies + FAQs: the ONE shared projection (ownerFacts.js), every topic the owner filled in
  const own = OF.kbRows(OF.ownerFacts(profile));
  const pf = OF.paymentFact(OF.ownerFacts(profile));
  const pay = pf ? (pf.owner_sw ? { en: pf.en, sw: pf.sw } : pf.en) : null;
  const policies = { ...own.policies }; delete policies.payment; if (pf) delete policies.deposit;
  return { services, hours: h ? h.text : null, payment: pay, policies, faqs: own.faqs, business: profile.businessName || null, agent: profile.agentName || null };
}

// ---------------------------------------------------------------- the one model call

const SYSTEM = [
  'You are the voice of a phone receptionist for one Kenyan business. You lead the conversation; the server checks every fact you say.',
  'Return ONLY JSON: {"understanding":{...},"tool_calls":[...],"reply":"..."} in that key order.',
  'understanding: lang (en|sw|mix), intents, slots {services[], date (YYYY-MM-DD or words), time (HH:MM 24h), places[] (EVERY place the caller named), name}, questions[] (EVERY question the caller asked, even without a question mark, e.g. "I wanted to know if you have X" is a coverage question; "tell me my name" is identity).',
  'reply: what you say next, max 2 short sentences plus at most ONE question. Answer every caller question first, using ONLY FACTS/RECEIPTS. One answer per place. Never say a price unless the caller asked for it.',
  'Never say booked, cancelled, noted, or that anyone will call/text unless RECEIPTS shows it; the server says the booked line and the read-back itself.',
  'Use the caller name only if CALLER.name is set. If only CALLER.candidate is set, you may ask "Am I speaking with <candidate>?".',
  'If the caller speaks Swahili or Sheng, reply in Swahili; English in English; mixed: their dominant language. Saa nane mchana = 14:00 (Swahili hours start at 7am).',
  'If PLAN.next is a slot, end with one question that asks for it. If a fact is not in FACTS/RECEIPTS say you are not sure and offer the team to confirm.',
  'Policy and FAQ questions (cancel, move, late, returns, delivery, guarantee, holds, any owner topic): answer from FACTS.policies / FACTS.faqs in the owner\'s words. A policy with {en, sw}: use sw for Swahili callers.',
].join('\n');
const PREFIX = new Map();
const SCHEMA = {
  type: 'object',
  properties: {
    understanding: { type: 'object', properties: {
      lang: { type: 'string', enum: ['en', 'sw', 'mix'] },
      intents: { type: 'array', items: { type: 'string', enum: ['book', 'ask', 'confirm', 'deny', 'cancel', 'reschedule', 'callback', 'take_message', 'goodbye', 'smalltalk', 'add_service', 'give_info'] } },
      slots: { type: 'object', properties: { services: { type: 'array', items: { type: 'string' } }, date: { type: 'string' }, time: { type: 'string' }, places: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } } },
      questions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['coverage', 'price', 'hours', 'identity', 'booking_status', 'payment', 'services', 'policy', 'faq', 'other'] }, subject: { type: 'string' } }, required: ['type'] } },
      confirms_pending: { type: 'boolean', nullable: true },
    }, propertyOrdering: ['lang', 'intents', 'slots', 'questions', 'confirms_pending'] },
    tool_calls: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: TOOL_NAMES() }, args: { type: 'object', properties: { places: { type: 'array', items: { type: 'string' } }, service: { type: 'string' }, reason: { type: 'string' }, text: { type: 'string' } } } }, required: ['name'] } },
    reply: { type: 'string' },
  },
  required: ['understanding', 'reply'],
  propertyOrdering: ['understanding', 'tool_calls', 'reply'],
};
function TOOL_NAMES() { return ['lookup_caller', 'check_coverage', 'kb_lookup', 'create_booking', 'add_service', 'reschedule_booking', 'cancel_booking', 'request_callback', 'take_message', 'save_caller_info', 'end_call']; }
const READ_ONLY = new Set(['lookup_caller', 'check_coverage', 'kb_lookup']);

function staticPrefix(profile = {}) {
  const k = kb(profile);
  const key = `${profile.id || profile.tenantId || ''}|${JSON.stringify(k).length}`;
  if (PREFIX.has(key)) return PREFIX.get(key);
  const p = {
    systemInstruction: { parts: [{ text: `${SYSTEM}\nFACTS (business, the only facts you may state): ${JSON.stringify(k)}` }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 400, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
  PREFIX.set(key, p);
  return p;
}

/** Context pack (no network): state snapshot + receipts + last 6 turns + this turn. */
function contextPack({ machine, text, profile, caller, coverage, langHint }) {
  const st = CP.step(machine, machine.lastLine || '', machine.lang || langHint || 'en');
  const s = machine.slots || {};
  const need = st.kind === 'readback' ? 'confirm_readback' : st.slot || (st.kind === 'confirmed' ? 'anything_else' : null);
  return {
    PLAN: { step: st.kind, next: need, intent: machine.intent || null, services: CP.plan(machine).items.map((i) => i.service), date: s.when && s.when.date || null, time: s.when && s.when.time || null, place: s.place || null, name: CP.lockedName(machine) },
    CALLER: { name: caller.name, candidate: caller.candidate, last_past_job: caller.last_past_job, upcoming: caller.upcoming, upcoming_count: caller.upcoming_count },
    RECEIPTS: { coverage: coverage.places.map((r) => ({ place: r.place, covered: r.covered, fee_kes: r.fee_kes, ...(r.note ? { owner_note: r.note, owner_note_lang: r.note_lang } : {}) })), this_turn: [] },
    HISTORY: (machine.v1History || []).slice(-6, -1).map((h) => `${h.role}: ${h.text}`),
    LANG_HINT: langHint || machine.lang || null,
    CALLER_SAID: String(text || ''),
  };
}
function buildRequest(pack, profile) {
  const p = staticPrefix(profile);
  return { ...p, contents: [{ role: 'user', parts: [{ text: JSON.stringify(pack) }] }] };
}

// ---------------------------------------------------------------- incremental JSON reading

function readString(buf, from) { // JSON string body starting after the opening quote; returns { text, closed }
  let out = ''; let i = from;
  while (i < buf.length) {
    const c = buf[i];
    if (c === '\\') { if (i + 1 >= buf.length) break; const n = buf[i + 1]; if (n === 'u') { if (i + 6 > buf.length) break; out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16)); i += 6; continue; } out += ({ n: '\n', t: '\t', r: '', '"': '"', '\\': '\\', '/': '/' })[n] ?? n; i += 2; continue; }
    if (c === '"') return { text: out, closed: true };
    out += c; i += 1;
  }
  return { text: out, closed: false };
}
/** Pull understanding as soon as its object closes, and the reply text as it streams. */
function partialParse(buf) {
  const out = { understanding: null, reply: null, replyClosed: false, toolCalls: null };
  const ri = buf.search(/"reply"\s*:\s*"/);
  const ti = buf.search(/"tool_calls"\s*:/);
  const cut = [ti, ri].filter((x) => x > 0).sort((a, b) => a - b)[0];
  if (cut) { try { out.understanding = JSON.parse(`${buf.slice(0, cut).replace(/,\s*$/, '')}}`).understanding || null; } catch { /* not yet */ } }
  if (ri >= 0 && ti > ri) { try { out.toolCalls = JSON.parse(`{${buf.slice(ti).replace(/}\s*$/, '')}}`).tool_calls || []; } catch { out.toolCalls = null; } }
  if (ti > 0 && ri > ti) { try { out.toolCalls = JSON.parse(`{${buf.slice(ti, ri).replace(/,\s*$/, '')}}`).tool_calls || []; } catch { out.toolCalls = null; } }
  if (ri >= 0) { const m = buf.slice(ri).match(/"reply"\s*:\s*"/); const r = readString(buf, ri + m[0].length); out.reply = r.text; out.replyClosed = r.closed; }
  return out;
}
const sentencesOf = (t, closed) => { const parts = String(t || '').match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []; const done = parts.map((x) => x.trim()).filter(Boolean); if (!closed && done.length && !/[.!?]$/.test(done[done.length - 1])) done.pop(); return done; };

// ---------------------------------------------------------------- hedged runner (decision 2)

/**
 * streamFor(id) -> async ({ request, signal, onText }) => { text }
 * Primary starts now; if it has no first token by hedgeMs (or fails), the backup starts in parallel.
 * The first attempt whose understanding parses wins; the other is aborted. Hard deadline hardMs.
 * Every attempt is traced (decision: per-attempt telemetry in voice_turn_traces).
 */
function runHedged({ streamFor, primaryId, backupId, request, deadlines = DEADLINES, clock = () => Date.now(), onProgress = () => {}, winWhen = (p) => !!p.understanding, okWhen = (full) => !!(full && full.understanding && typeof full.reply === 'string') }) {
  const t0 = clock(); const attempts = []; let winner = null; let settled = false; let hedgeTimer = null; let hardTimer = null;
  let resolveDone; const done = new Promise((r) => { resolveDone = r; });
  const finish = (why) => { if (settled) return; settled = true; clearTimeout(hedgeTimer); clearTimeout(hardTimer); for (const a of attempts) if (a !== winner && !a.end) { a.ac.abort(); a.outcome = a.outcome || 'cancelled'; a.ms = clock() - t0 - a.startMs; a.end = true; } resolveDone({ winner, attempts, why }); };
  function start(id, role) {
    const a = { model: id, role, startMs: clock() - t0, firstTokenMs: null, ms: null, outcome: null, buf: '', ac: new AbortController(), end: false };
    attempts.push(a);
    Promise.resolve().then(() => streamFor(id)({ request, signal: a.ac.signal, onText: (d) => {
      if (settled && winner !== a) return;
      if (a.firstTokenMs == null) a.firstTokenMs = clock() - t0;
      a.buf += d;
      const p = partialParse(a.buf);
      if (!winner && winWhen(p)) { winner = a; for (const b of attempts) if (b !== a && !b.end) { b.ac.abort(); b.outcome = 'lost_race'; b.end = true; b.ms = clock() - t0 - b.startMs; } clearTimeout(hedgeTimer); }
      if (winner === a) onProgress(a, p);
    } })).then((res) => {
      if (a.end) return;
      if (res && typeof res.text === 'string' && res.text.length > a.buf.length) { a.buf = res.text; }
      a.end = true; a.ms = clock() - t0 - a.startMs;
      let full = null; try { full = JSON.parse(a.buf); } catch { full = null; }
      a.outcome = okWhen(full) ? 'ok' : 'invalid_json';
      if (a.outcome === 'ok' && (!winner || winner === a)) { winner = a; a.final = full; onProgress(a, { understanding: full.understanding || null, full, toolCalls: full.tool_calls || [], reply: typeof full.reply === 'string' ? full.reply : null, replyClosed: true }); finish('ok'); return; }
      if (winner === a) { winner = null; }
      maybeBackup(); if (attempts.every((x) => x.end)) finish('all_failed');
    }).catch((e) => {
      if (a.end) return;
      a.end = true; a.ms = clock() - t0 - a.startMs; a.outcome = /timeout/i.test(String(e && (e.code || e.message))) ? 'timeout' : (e && e.code) || 'error';
      if (winner === a) winner = null;
      maybeBackup(); if (attempts.every((x) => x.end)) finish('all_failed');
    });
    return a;
  }
  function maybeBackup() { if (!settled && backupId && !attempts.some((x) => x.role === 'backup')) start(backupId, 'backup'); }
  start(primaryId, 'primary');
  hedgeTimer = setTimeout(() => { if (!winner && attempts[0].firstTokenMs == null) maybeBackup(); }, deadlines.hedgeMs);
  hardTimer = setTimeout(() => { for (const a of attempts) if (!a.end) { a.outcome = 'deadline'; } if (winner && !winner.end) { /* reply still streaming: keep what we have */ } finish('deadline'); }, deadlines.hardMs);
  return { done, attempts, t0 };
}

// ---------------------------------------------------------------- guard + verifier (G1-G10)

const NEG = /\b(don'?t|do not|doesn'?t|not|no longer|sorry|unfortunately|outside|hatufiki|hatuji|hatuendi|hatufanyi|haifiki|siwezi)\b/i;
const UNSURE = /\b(not sure|can'?t confirm|cannot confirm|don'?t know|sina uhakika|hatuna hakika|sijui|siwezi kuthibitisha)\b/i;
const PRICE_WORD = /\b(ksh|kes|shillings?|bob|bei|gharama|elfu|thousand|hundred|mia)\b|\b\d[\d,]{2,}\b/i;
const isQ = (s) => /\?\s*$/.test(String(s || '').trim());
const nums = (s) => (String(s).match(/\d[\d,]*/g) || []).map((x) => x.replace(/,/g, ''));

// model phrasings the #932 CLAIM list misses (seen in the case set); lead-path only so flag-off is unchanged
const CLAIM_MORE = /\b(?:i'?ll|i will|we'?ll|we will) (?:pass|send|forward|relay) (?:it|that|this|your message)(?: on)?|(?:i'?ll|i will) (?:let|tell|inform) (?:the )?(?:owner|manager|team)|nitampa ujumbe|nitamwambia\b/i;

function guardTools(calls = [], machine, caller) {
  const out = [];
  for (const c of Array.isArray(calls) ? calls : []) {
    const name = c && c.name; if (!TOOL_NAMES().includes(name)) { out.push({ name, verdict: 'reject', reason: 'unknown_tool' }); continue; }
    if (READ_ONLY.has(name)) { out.push({ name, verdict: 'run_in_code', args: c.args || {} }); continue; }
    // writes: the state owner (machine) commits only after its own read-back yes / row checks (G1)
    if (name === 'create_booking' && !(machine.phase === 'readback' && machine.pending)) { out.push({ name, verdict: 'reject', reason: 'no_confirmed_readback' }); continue; }
    if ((name === 'cancel_booking' || name === 'reschedule_booking') && !caller.upcoming.length) { out.push({ name, verdict: 'reject', reason: 'no_upcoming_booking' }); continue; }
    if (name === 'save_caller_info' && !CP.lockedName(machine)) { out.push({ name, verdict: 'reject', reason: 'name_not_locked' }); continue; }
    out.push({ name, verdict: 'state_owner', args: c.args || {} });
  }
  return out;
}

/**
 * Sentence verifier. ctx = { st, receipts (this turn, ok), coverage rows, caller, profile, questions, lang, machine }.
 * Returns { verdict: 'pass'|'drop'|'repair', text, reason, subject, fix } — fix is the code-built honest sentence.
 */
function makeVerifier(ctx) {
  const answered = new Map(); // subject -> polarity already spoken (G4)
  const asked = new Set((ctx.questions || []).map((q) => q.type));
  const prices = new Set(); for (const s of ctx.profile.servicesCatalog || []) { for (const n of nums(s.price_range || '')) prices.add(n); const pl = RF.priceLine(s, ctx.text || '', ctx.lang); for (const n of (pl && pl.nums) || []) prices.add(n); }
  const known = new Map(ctx.coverage.map((r) => [r.place.toLowerCase(), r]));
  const act = { questions: 0, claimed: false };
  const ownerOf = OF.ownerFacts(ctx.profile || {});
  const lockName = CP.lockedName(ctx.machine);
  const cand = ctx.caller.candidate;
  function placesIn(s) {
    const hits = [];
    const named = placesNamedInText(s);
    for (const name of named) {
      const r = known.get(name.toLowerCase());
      if (r && !hits.some((h) => h.place.toLowerCase() === r.place.toLowerCase())) hits.push(r);
    }
    const allowed = callerAllowedPlaces(ctx);
    const unasked = named.filter((p) => !known.has(p.toLowerCase()) && !allowed.has(p.toLowerCase()));
    return { hits, unasked };
  }
  function check(raw) {
    const s = String(raw || '').trim(); if (!s) return { verdict: 'drop', reason: 'empty' };
    // G2 claims need a receipt from this turn
    if ((CC.CLAIM.test(s) || CLAIM_MORE.test(s)) && !ctx.receipts.length && !(ctx.callerReadOk && backedByCaller(s, ctx.caller))) return { verdict: 'drop', reason: 'claim_without_receipt' };
    if (ctx.callerReadOk && pastAsOpen(s, ctx.caller)) return { verdict: 'drop', reason: 'past_job_as_open' };
    // shared owner-fact check (ownerFacts.js): policy numbers come from the owner's facts; a backed policy fee is not a price
    const pc = OF.checkPolicySentence(s, ownerOf, ctx.lang);
    if (pc) return { verdict: 'repair', reason: pc.reason, subject: 'policy', fix: pc.fix };
    const policyBacked = !!OF.backingFact(s, ownerOf);
    // G8 no unasked price (decision 4)
    const priceish = !policyBacked && PRICE_WORD.test(s) && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|saa\s/i.test(s) && !/\b(20\d\d|october|oktoba)\b/i.test(s);
    if (priceish && !asked.has('price')) {
      // keep the yes/confirm half ("Ndiyo, tunafanya deep cleaning"); only the price clause is dropped
      const keep = yesClause(s);
      return keep ? { verdict: 'pass', text: keep, reason: 'unasked_price_trimmed' } : { verdict: 'drop', reason: 'unasked_price' };
    }
    if (priceish && asked.has('price') && nums(s).some((n) => !prices.has(n))) return { verdict: 'repair', reason: 'price_not_in_kb', subject: 'price', fix: priceFix(ctx) };
    // G3/G4 coverage: polarity must equal the receipt; one answer per place
    const { hits, unasked: un0 } = placesIn(s);
    // a place the caller did not name: fine when it is the caller's own booking address (lookup_caller receipt); checked
    // against a LOCAL receipt (never added to the turn's rows/owed answers) when the caller asked "where do you cover?";
    // otherwise the sentence is dropped, never repaired into a new claim (HD_7a9915837b00 "hatufiki Kutus")
    const fileText = ctx.callerReadOk ? JSON.stringify([ctx.caller.last_past_job, ...(ctx.caller.upcoming || [])]).toLowerCase() : '';
    const unasked = un0.filter((p) => !fileText.includes(p.toLowerCase()));
    if (unasked.length && asked.has('coverage') && !ctx.coverage.some((r) => r.from === 'caller')) { for (const p of unasked) { const r = coverageReceipt([p], ctx.profile).places[0]; if (r && !hits.includes(r)) hits.push(r); } }
    else if (unasked.length) return { verdict: 'drop', reason: `unasked_place:${unasked[0]}`, subject: `place:${unasked[0].toLowerCase()}` };
    if (hits.length && !(ctx.st.kind === 'readback' && isQ(s))) {
      const pol = UNSURE.test(s) ? 'unknown' : NEG.test(s) ? 'no' : 'yes';
      for (const r of hits) {
        const key = `place:${r.place.toLowerCase()}`;
        if (answered.has(key)) return { verdict: 'drop', reason: 'second_answer_same_subject', subject: key };
        const says = isQ(s) && pol === 'yes' ? null : pol; // "Which part of Kilimani?" asks, does not claim
        if (says && says !== r.covered && !(r.covered === 'unknown' && says !== 'yes')) return { verdict: 'repair', reason: `coverage_mismatch:${r.place}`, subject: key, fix: coverageSentence(r, ctx.lang) };
      }
      for (const r of hits) answered.set(`place:${r.place.toLowerCase()}`, true);
    }
    // G10 name lock: an unconfirmed name is never stated as fact
    if (cand && !lockName && new RegExp(`\\b${cand}\\b`, 'i').test(s) && !isQ(s)) return { verdict: 'repair', reason: 'name_not_locked', subject: 'identity', fix: sw(ctx.lang) ? `Je, naongea na ${cand}?` : `Am I speaking with ${cand}?` };
    const claimed = s.match(/\b(?:you(?:'re| are)|your name is|jina lako ni|wewe ni)\s+([A-Z][a-z]+)/);
    if (claimed && claimed[1] !== lockName && claimed[1] !== cand) return { verdict: 'repair', reason: 'name_not_in_state', subject: 'identity', fix: identityFix(ctx) };
    // the step (one question, read-back exact, no "booked" before the write)
    const g = CP.actCheck(s, ctx.st, act);
    if (g.verdict === 'pass' && isQ(s)) act.questions += 1;
    if (g.verdict === 'replace' && isQ(g.text)) act.questions += 1;
    return g.verdict === 'pass' ? { verdict: 'pass', text: s } : g.verdict === 'drop' ? { verdict: 'drop', reason: g.reason } : { verdict: 'replace', text: g.text, reason: g.reason };
  }
  return { check, act, answered };
}
function priceFix(ctx) {
  const svc = (ctx.profile.servicesCatalog || []).find((x) => x.name === (ctx.machine.slots && ctx.machine.slots.service)) || CP.matchServices(ctx.text || '', ctx.profile)[0];
  const pl = RF.priceLine(svc, ctx.text || '', ctx.lang); if (pl) return pl.text;
  return sw(ctx.lang) ? 'Sina bei kamili hapa; timu inaweza kuthibitisha.' : "I don't have the exact price here; the team can confirm.";
}
/** The confirm clause of a sentence whose price part is unasked: "Ndiyo, tunafanya X, bei ni KSh 6,000" -> "Ndiyo, tunafanya X." */
const YES_HEAD = /^(yes|yeah|sure|we do|ndiyo|ndio|naam|tunafanya|tunatoa)\b/i;
function yesClause(s) {
  const t = String(s || '').trim(); if (!YES_HEAD.test(t)) return null;
  const m = t.match(PRICE_WORD); if (!m) return null;
  // cut at the last clause break before the first price word, so the kept words are verbatim
  const head = t.slice(0, m.index); const SEP = /(?:,|;|\s[–—-]\s|\.\s|\s(?:(?:and|na) (?:it costs|it is|it's|bei ni|ni)|and|na|at|for|kwa|it costs|costs|bei ni|bei|ni kati ya|from|starting)\s)/gi;
  let cut = -1; for (let x; (x = SEP.exec(head));) cut = x.index;
  let out = cut > 0 ? head.slice(0, cut) : '';
  out = out.replace(/[,;\s]+$/, ''); if (!out || out.length < 3 || PRICE_WORD.test(out)) return null;
  if (/^(yes|yeah|sure|ndiyo|ndio|naam)$/i.test(out)) return null; // a bare "yes" carries nothing on its own
  return /[.!?]$/.test(out) ? out : `${out}.`;
}
const normQ = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f ]+/g, ' ').replace(/\s+/g, ' ').trim();
const REPLY_WORD = /^\s*(yes|yeah|yep|no|nope|sure|ok(ay)?|ndiyo|ndio|hapana|sawa|naam|si(o)?)\b/i;
const REASK_MIN_MS = 20000;
function identityFix(ctx) {
  const n = CP.lockedName(ctx.machine); const c = ctx.caller.candidate;
  if (n) return sw(ctx.lang) ? `Jina lako ni ${n}.` : `You're ${n}.`;
  if (c) return sw(ctx.lang) ? `Nina jina ${c} hapa. Je, ni wewe?` : `I have ${c} on file. Is that you?`;
  return sw(ctx.lang) ? 'Sina jina lako bado. Naweza kujua jina lako?' : "I don't have your name yet. May I have it?";
}

/** G7: a question the kept reply does not answer gets the code's honest answer (placed before the step question).
 *  The ONE owed-answer structure (owed.js): (topic, sub-question, turn language), rendered from the stores. */
function owedAnswers(ctx, keptText) {
  const OW = require('./owed');
  const list = OW.collect({ questions: ctx.questions || [], coverage: ctx.coverage || [], text: ctx.text || '', profile: ctx.profile || {}, machine: ctx.machine, lang: ctx.lang, confirm: ctx.confirm || [] });
  const out = [];
  for (const o of list) { if (OW.answered(o, keptText, ctx)) continue; const text = OW.render(o, ctx); if (text) out.push({ subject: o.sub ? `${o.topic}:${o.sub}` : o.topic, topic: o.topic, sub: o.sub, text }); }
  return out;
}
function upcomingLine(up, lang) {
  const say = (u) => `${u.service}${u.date && /^\d{4}-/.test(u.date) ? ` ${sw(lang) ? '' : 'on '}${L.sayDate(u.date, lang)}` : ''}`;
  return sw(lang) ? `Una booking ${up.length}: ${up.map(say).join('; ')}.` : `You have ${up.length} upcoming booking${up.length > 1 ? 's' : ''}: ${up.map(say).join('; ')}.`;
}

/** Decision 5: greeting by name only if confirmed on an earlier call; otherwise ask. [PROMPT-PLACEHOLDER] */
function openingLine(file = {}, { lang = 'en', business = '' } = {}) {
  const S = sw(lang);
  if (file.nameConfirmed && !file.sharedLine && file.contactName) return S ? `Karibu tena, ${file.contactName}. Nikusaidie aje leo?` : `Welcome back, ${file.contactName}. How can I help today?`;
  if (!file.sharedLine && file.contactName) return S ? `Habari, je naongea na ${file.contactName}?` : `Hello, am I speaking with ${file.contactName}?`;
  return null; // stock opening
}

/** Booking whenText the executor keeps: "YYYY-MM-DD 2:00 PM" (24h "14:00" is read as day-only and drops the time). */
function storedWhenText(when) {
  if (!when || !when.date) return '';
  if (!when.time) return when.date;
  const [h, m] = when.time.split(':').map(Number);
  return `${when.date} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
/** G5: the saved row must equal the read-back (date, time, services, place). */
function compareSaved(expected = {}, saved = null) {
  if (!saved) return { ok: false, missing: ['saved_row'] };
  const bad = [];
  const iso = saved.windowStart || saved.window_start || '';
  if (expected.when && expected.when.date) {
    const want = L.whenToIso(expected.when);
    if (expected.when.time) { if (!iso || Date.parse(iso) !== Date.parse(want)) bad.push('time'); }
    const day = iso ? L.isoDate(L.eatParts(new Date(iso))) : (String(saved.whenText || '').match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
    if (day && day !== expected.when.date) bad.push('date');
  }
  if (expected.place && saved.landmark && String(saved.landmark).toLowerCase() !== String(expected.place).toLowerCase()) bad.push('place');
  const svcSaved = String(saved.serviceName || saved.service_name || '').toLowerCase();
  if (expected.service && svcSaved && !svcSaved.includes(String(expected.service).toLowerCase().split(' (')[0])) bad.push('service');
  return { ok: bad.length === 0, mismatch: bad };
}

/** Model understanding -> the machine's turn fields (evidence; the machine's rules still veto). */
/**
 * Cancel question vs cancel request, from the understanding: a request is the cancel intent with a named booking
 * (booking_ref) or no question attached; a policy/other question with no such request is the policy question.
 * No understanding: the rules decide only an explicit request (the cancel intent alone); any other cancel turn
 * gets a short clarifying question ('clarify'), never a guess. null = not a cancel turn.
 */
function cancelKind(u, machine = {}, text = '', profile = {}, now = new Date()) {
  const N = require('./nlu');
  const rules = N.detectIntents(String(text || ''));
  // the cancel TOPIC: the rules' cancel intents or the owner's own cancellation fact matching the caller's words (any language)
  const ruleCancel = rules.includes('cancel') || rules.includes('policy_cancel') || OF.match(String(text || ''), OF.ownerFacts(profile)).some((f) => f.topic === 'cancellation');
  if (u) {
    const wants = (u.intents || []).includes('cancel');
    const ref = !!(u.booking_ref && Object.values(u.booking_ref).some((v) => v && String(v).trim()));
    const asking = (u.questions || []).some((q) => q && (q.type === 'policy' || q.type === 'other'));
    if (wants && (ref || !asking || (machine.slots && machine.slots.row))) return 'request';
    if (asking && (wants || ruleCancel)) return 'policy';
    return null;
  }
  if (!ruleCancel) return null;
  if (rules.includes('policy_cancel') && !rules.includes('cancel')) return null; // the rules' own policy reading stands ("cancellation policy")
  // a named booking (a day, service or place the rules extract, or a held row) makes it a request; otherwise ask
  const nu = N.understand(String(text || ''), { profile, now, expecting: machine.expecting || null });
  if ((nu.when && nu.when.date) || nu.service || nu.area || (machine.slots && machine.slots.row)) return 'request';
  return 'clarify';
}
function turnFieldsOf(u, profile = {}) {
  if (!u) return null;
  const asks = [];
  for (const q of u.questions || []) { if (q.type === 'coverage') asks.push('coverage'); if (q.type === 'price') asks.push('price'); if (q.type === 'hours') asks.push('hours'); if (q.type === 'services') asks.push('services'); }
  if ((u.intents || []).includes('book')) asks.push('book');
  const svcName = ((u.slots || {}).services || [])[0];
  const svc = svcName ? ((profile.servicesCatalog || []).find((s) => s.name.toLowerCase() === String(svcName).toLowerCase()) || CP.matchServices(svcName, profile)[0]) : null;
  const place = ((u.slots || {}).places || [])[0] || null;
  return { asks: [...new Set(asks)], place, service_id: svc ? svc.id : null };
}

// ---------------------------------------------------------------- split path: understanding (parallel) + reply-first

const U_SYSTEM = [
  'Read ONE caller turn on a Kenyan business phone line. Return ONLY JSON, nothing else.',
  'intents: what the caller wants now. questions: EVERY question, also ones with no question mark ("I wanted to know if you have Kilimani" = coverage; "tell me my name" = identity; "do you accept crypto" = payment).',
  'cancel: intents has "cancel" ONLY when the caller asks us to cancel a booking ("cancel my Monday clean"); "can I cancel?" / "what if I cancel?" is a question {type:"policy",subject:"cancellation"}, not the intent.',
  'places: EVERY place named, each separately ("Kilimani Westlands" = ["Kilimani","Westlands"]). booking_ref: words that point at an existing booking (service/day/place, or "it"). lang: en|sw|mix.',
].join('\n');
const U_SCHEMA = {
  type: 'object',
  properties: {
    lang: { type: 'string', enum: ['en', 'sw', 'mix'] },
    intents: { type: 'array', items: { type: 'string', enum: ['book', 'ask', 'confirm', 'deny', 'cancel', 'reschedule', 'booking_status', 'identity', 'callback', 'take_message', 'goodbye', 'smalltalk', 'add_service', 'give_info'] } },
    questions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['coverage', 'price', 'hours', 'identity', 'booking_status', 'payment', 'services', 'policy', 'other'] }, subject: { type: 'string' } }, required: ['type'] } },
    places: { type: 'array', items: { type: 'string' } },
    booking_ref: { type: 'object', properties: { service: { type: 'string' }, date: { type: 'string' }, place: { type: 'string' } } },
    slots: { type: 'object', properties: { services: { type: 'array', items: { type: 'string' } }, date: { type: 'string' }, time: { type: 'string' }, name: { type: 'string' } } },
    confirms_pending: { type: 'boolean', nullable: true },
  },
  required: ['intents', 'questions'],
  propertyOrdering: ['lang', 'intents', 'questions', 'places', 'booking_ref', 'slots', 'confirms_pending'],
};
function understandRequest({ text, machine, lastLine }) {
  return {
    systemInstruction: { parts: [{ text: U_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ UNDERSTAND: true, AGENT_LAST: String(lastLine || machine.lastLine || '').slice(0, 200), EXPECTING: machine.expecting || null, CALLER_SAID: String(text || '') }) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 160, responseMimeType: 'application/json', responseSchema: U_SCHEMA, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
}
/** Normalise either the split schema or the #933 combined {understanding:{...}} into one understanding shape. */
function normUnderstanding(full) {
  if (!full || typeof full !== 'object') return null;
  const u = full.understanding && typeof full.understanding === 'object' ? full.understanding : full;
  if (!Array.isArray(u.intents) && !Array.isArray(u.questions)) return null;
  const slots = { ...(u.slots || {}) };
  slots.places = [...new Set([...(Array.isArray(u.places) ? u.places : []), ...(Array.isArray(slots.places) ? slots.places : [])])];
  slots.services = Array.isArray(slots.services) ? slots.services : [];
  return { lang: u.lang || null, intents: u.intents || [], questions: u.questions || [], slots, booking_ref: u.booking_ref || null, confirms_pending: u.confirms_pending ?? null };
}

const R_SYSTEM = [
  'You are the voice of a phone receptionist for one Kenyan business. The server checks every fact you say.',
  'Return ONLY JSON {"reply":"...","tool_calls":[...]} with reply FIRST.',
  'reply: max 2 short sentences plus at most ONE question. Answer every caller question first, using ONLY FACTS/CALLER/RECEIPTS. One answer per place. Never say a price unless the caller asked.',
  'Never say booked, cancelled, noted, or that anyone will call/text unless RECEIPTS.writes shows it; the server says the booked line and the read-back.',
  'CALLER is the caller file: you may describe their upcoming bookings (service, day, place) exactly as listed; past jobs only as past. Use CALLER.name only if set; with only CALLER.candidate ask "Am I speaking with <candidate>?".',
  'Swahili/Sheng caller: reply in Swahili. Saa nane mchana = 14:00. If PLAN.next is a slot, end with one question for it. A fact not given: say you are not sure and offer the team to confirm.',
].join('\n');
const R_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' }, tool_calls: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: TOOL_NAMES() }, args: { type: 'object', properties: { places: { type: 'array', items: { type: 'string' } }, service: { type: 'string' }, date: { type: 'string' }, reason: { type: 'string' } } } }, required: ['name'] } } },
  required: ['reply'], propertyOrdering: ['reply', 'tool_calls'],
};
const RPREFIX = new Map();
/** Trimmed facts: service names (+ price only as a string the model may quote when asked), hours, payment. */
function replyRequest(pack, profile = {}) {
  const k = kb(profile); const facts = { business: k.business, agent: k.agent, services: k.services.map((x) => (x.price ? `${x.name} (${x.price})` : x.name)), hours: k.hours, payment: k.payment };
  const key = `${profile.id || profile.tenantId || ''}|${JSON.stringify(facts).length}`;
  if (!RPREFIX.has(key)) RPREFIX.set(key, { systemInstruction: { parts: [{ text: `${R_SYSTEM}\nFACTS: ${JSON.stringify(facts)}` }] }, generationConfig: { temperature: 0.3, maxOutputTokens: 160, responseMimeType: 'application/json', responseSchema: R_SCHEMA, thinkingConfig: { thinkingLevel: 'MINIMAL' } } });
  return { ...RPREFIX.get(key), contents: [{ role: 'user', parts: [{ text: JSON.stringify(pack) }] }] };
}

// ---------------------------------------------------------------- lookup_caller (real receipt tool, in memory)

const SVC_WORD = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/cleaning|service|wash(ing)?/g, '').trim().split(/\s+/)[0] || '';
/**
 * lookup_caller({service?, date?, place?}) over the caller file already in RAM (no network, <10 ms).
 * Receipt: { tool, ok, receipt_id, name, name_confirmed, candidate, upcoming[<=3 open, future], match:{kind unique|candidates|none, row_id, candidates[]},
 *            past_jobs[<=2, read_only], addresses[<=3], notes[<=3], ms }. Past rows are never a match target.
 */
function lookupCaller(file = {}, filters = {}, { now = new Date(), lockedName = null } = {}) {
  const t0 = Date.now();
  const base = callerReceipt(file, { now, lockedName });
  const rows = (file.openRows || []).filter(Boolean);
  const t = now.getTime();
  const startOf = (r) => { const iso = r.window_start || r.windowStart; if (iso) return Date.parse(iso); if (r.when && r.when.date) return Date.parse(`${r.when.date}T${r.when.time || '23:59'}:00+03:00`); return NaN; };
  const svc = (r) => r.service_name || r.service || r.job || r.item || null;
  const timeOf = (r) => { const s = startOf(r); if (!Number.isFinite(s) || !(r.window_start || r.windowStart || (r.when && r.when.time))) return null; const p = L.eatParts(new Date(s)); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const upcoming = base.upcoming.map((u) => ({ ...u, time: byId.has(u.id) ? timeOf(byId.get(u.id)) : null }));
  const past = rows.filter((r) => svc(r) && Number.isFinite(startOf(r)) && startOf(r) < t).sort((a, b) => startOf(b) - startOf(a));
  const pastJobs = [...past, ...(file.lastVisit && svc(file.lastVisit) ? [file.lastVisit] : [])]
    .filter((r, i, a) => a.findIndex((x) => (x.id && x.id === r.id)) === i || !r.id).slice(0, 2)
    .map((r) => ({ id: r.id || null, service: svc(r), date: Number.isFinite(startOf(r)) ? L.isoDate(L.eatParts(new Date(startOf(r)))) : null, place: r.address_landmark || r.place || null, read_only: true }));
  const addresses = [...new Set(rows.map((r) => r.address_landmark || r.place).filter(Boolean))].slice(0, 3);
  const notes = (Array.isArray(file.notes) ? file.notes : file.notes ? [file.notes] : []).concat(file.preferences ? [].concat(file.preferences) : []).map((x) => String(x).slice(0, 120)).slice(0, 3);
  const f = { service: filters.service ? SVC_WORD(filters.service) : null, date: filters.date || null, place: filters.place ? String(filters.place).toLowerCase() : null };
  let cands = upcoming;
  if (f.service) cands = cands.filter((u) => SVC_WORD(u.service) === f.service || String(u.service || '').toLowerCase().includes(f.service));
  if (f.date) cands = cands.filter((u) => u.date === f.date);
  if (f.place) cands = cands.filter((u) => String(u.place || '').toLowerCase().includes(f.place));
  const filtered = !!(f.service || f.date || f.place);
  const kind = !upcoming.length ? 'none' : cands.length === 1 && (filtered || upcoming.length === 1) ? 'unique' : cands.length ? 'candidates' : 'none';
  return {
    tool: 'lookup_caller', ok: true, receipt_id: `lc_${t0.toString(36)}`,
    name: base.name, name_confirmed: base.name_confirmed, candidate: base.candidate,
    upcoming, upcoming_count: base.upcoming_count, last_past_job: base.last_past_job,
    match: { kind, row_id: kind === 'unique' ? cands[0].id : null, candidates: kind === 'candidates' ? cands.slice(0, UPCOMING_MAX) : [] },
    past_jobs: pastJobs, addresses, notes, filters: f, ms: Date.now() - t0,
  };
}
const ROW_INTENT = /\b(reschedul\w*|move|change|shift|postpone|cancel\w*|ghairi|badilisha|hamisha|my booking|the booking|my appointment|booking yangu|when is my|what'?s my name|my name|jina langu|add (?:a |another )?service|ongeza)\b/i;
/** Filters for lookup_caller from the rules (and the model's booking_ref when it is in). */
function callerFilters(text, profile = {}, u = null, now = new Date()) {
  const ref = (u && u.booking_ref) || {};
  const svc = ref.service || (CP.matchServices(text || '', profile)[0] || {}).name || null;
  const d = ref.date && /^\d{4}-\d{2}-\d{2}$/.test(ref.date) ? ref.date : (L.parseDate ? (L.parseDate(text || '', now) || {}).date || null : null);
  const place = ref.place || null;
  return { service: svc, date: d, place };
}
function offerRowsLine(cands, lang) {
  const say = (u) => `${sw(lang) ? '' : 'the '}${String(u.service || '').replace(/\s*\(.*?\)/, '').toLowerCase()}${u.date ? ` ${sw(lang) ? 'ya' : 'on'} ${L.sayDate(u.date, lang)}` : ''}${u.place ? ` ${sw(lang) ? '' : 'in '}${u.place}` : ''}`;
  if (cands.length === 1) return sw(lang) ? `Ni ${say(cands[0])}?` : `Is it ${say(cands[0])}?`; // [PROMPT-PLACEHOLDER]
  return sw(lang) ? `Ni ipi: ${cands.map(say).join(', au ')}?` : `Which one: ${cands.map(say).join(', or ')}?`; // [PROMPT-PLACEHOLDER]
}
/** A sentence that only describes a caller-file row (service+day[/place]) is backed by the lookup_caller receipt. */
function backedByCaller(s, caller) {
  if (!caller || !Array.isArray(caller.upcoming)) return false;
  const low = String(s).toLowerCase();
  if (CC.CLAIM.test(String(s).replace(/\b(scheduled|confirmed)\b/gi, ''))) return false; // write claims still need a write receipt
  const dayHit = (d) => { if (!d) return false; const dd = new Date(`${d}T12:00:00+03:00`); const dow = dd.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi' }).toLowerCase(); const dom = String(Number(d.slice(8, 10))); return low.includes(dow) || new RegExp(`\\b${dom}(st|nd|rd|th)?\\b`).test(low) || low.includes(String(L.sayDate(d, 'en')).toLowerCase()); };
  const rowHit = (u) => SVC_WORD(u.service) && low.includes(SVC_WORD(u.service)) && dayHit(u.date);
  const pastHit = (caller.past_jobs || []).some((p) => rowHit(p)) || (caller.last_past_job && rowHit(caller.last_past_job));
  const upHit = caller.upcoming.some(rowHit);
  if (pastHit && !upHit && !/\b(last|previous|past|was|did|had)\b/.test(low)) return false; // a past job is never spoken as open
  return upHit || (pastHit && /\b(last|previous|past|was|did|had)\b/.test(low));
}
/** A sentence that names a PAST caller-file job as if it were open/upcoming (old bookings are never offered or edited). */
function pastAsOpen(s, caller) {
  if (!caller || !Array.isArray(caller.past_jobs)) return false;
  const low = String(s).toLowerCase();
  if (/\b(last|previous|past|was|did|had|ilikuwa|iliyopita)\b/.test(low)) return false;
  const dayHit = (d) => { if (!d) return false; const dom = String(Number(d.slice(8, 10))); const mon = new Date(`${d}T12:00:00+03:00`).toLocaleDateString('en-US', { month: 'long', timeZone: 'Africa/Nairobi' }).toLowerCase(); return new RegExp(`\\b${dom}(st|nd|rd|th)?\\b`).test(low) && low.includes(mon); };
  const up = (caller.upcoming || []).some((u) => dayHit(u.date));
  return !up && caller.past_jobs.some((p) => dayHit(p.date) && (low.includes(SVC_WORD(p.service)) || (p.place && low.includes(String(p.place).toLowerCase()))));
}
/** Payment question (KB answer, or honest unknown for a method the KB does not list, e.g. crypto). [PROMPT-PLACEHOLDER] */
function paymentAnswer(profile = {}, text = '', lang = 'en') {
  const pf = OF.paymentFact(OF.ownerFacts(profile));
  const pay = pf ? (sw(lang) ? pf.sw : pf.en) : '';
  const asked = (String(text).match(/\b(crypto\w*|bitcoin|usdt|card|visa|mastercard|cheque|check|paypal|m-?pesa|cash|bank|airtel money)\b/i) || [])[1];
  if (!pay) return sw(lang) ? 'Sina uhakika wa njia za malipo; timu inaweza kuthibitisha.' : "I'm not sure about payment options; the team can confirm.";
  const listed = asked && new RegExp(asked.replace(/s$/, ''), 'i').test(pf.en);
  // the owner's own sentences, never stitched behind a prefix ([PROMPT-PLACEHOLDER] for the unlisted-method lead-in)
  if (asked && !listed) return sw(lang) ? `Sina uhakika kama tunakubali ${asked}. ${pay}` : `I'm not sure we take ${asked}. ${pay}`;
  return pay;
}
const UNASKED_PRICE = (s) => PRICE_WORD.test(s) && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|saa\s/i.test(s) && !/\b(20\d\d|october|oktoba)\b/i.test(s);

module.exports = { yesClause, normQ, REPLY_WORD, REASK_MIN_MS, NEG, UNSURE, cancelKind, upcomingLine, coverageFor, addCallerPlaces, rememberCallerPlaces, callerAllowedPlaces, placesNamedInText, scanPlaces, owedCoverageQuestion, leadOn, splitOn, leadModels, SPLIT_DEADLINES, understandRequest, normUnderstanding, replyRequest, lookupCaller, callerFilters, ROW_INTENT, offerRowsLine, backedByCaller, pastAsOpen, paymentAnswer, UNASKED_PRICE, U_SCHEMA, R_SCHEMA, DEADLINES, UPCOMING_MAX, callerReceipt, placeCandidates, coverageReceipt, coverageAnswer, coverageSentence, kb, contextPack, buildRequest, staticPrefix, partialParse, sentencesOf, runHedged, guardTools, makeVerifier, owedAnswers, openingLine, storedWhenText, compareSaved, turnFieldsOf, identityFix, SCHEMA };
