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

/** Place phrases in a caller turn: split on "or/and/au/na/ama/," then the tree matcher per piece (local, no network). */
function placeCandidates(text) {
  const parts = String(text || '').split(/\s*(?:,|\bor\b|\band\b|\bau\b|\bama\b|\bna\b|\bwala\b)\s*/i).filter((p) => p && p.trim());
  const out = [];
  for (const p of parts) { const m = AC.treeMatch(p); if (m && m.node && !out.includes(m.node.name)) out.push(m.node.name); }
  return out;
}

/** check_coverage receipt: one row per place (1..5). Picks resolver per place; legacy only when no picks. */
function coverageReceipt(places = [], profile = {}) {
  const rows = [];
  for (const raw of places.slice(0, 5)) {
    const p = String(raw || '').trim(); if (!p) continue;
    const r = AC.resolve(p, profile) || AC.resolve(p.replace(/\b[a-z]/g, (c) => c.toUpperCase()), profile);
    const name = r && r.name ? r.name : p.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    if (rows.some((x) => x.place.toLowerCase() === name.toLowerCase())) continue;
    const covered = !r || r.status === 'unknown' ? 'unknown' : r.status === 'covered' ? 'yes' : 'no';
    rows.push({ place: name, said: p, matched_node: r && r.node || null, covered, status: r ? r.status : 'unknown', source: r && r.source === 'picks' ? 'area_picks' : 'legacy', line_en: r && r.status !== 'unknown' ? AC.line(r, 'en') : null, line_sw: r && r.status !== 'unknown' ? AC.line(r, 'sw') : null, fee_kes: r && r.fee_kes != null ? r.fee_kes : null });
  }
  return { tool: 'check_coverage', ok: true, places: rows };
}

/** One honest coverage sentence per place, never stacked ([PROMPT-PLACEHOLDER]). */
function coverageSentence(row, lang) {
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

/** KB slice the model may quote (prices only reach the caller when asked: G8). */
function kb(profile = {}) {
  const services = (profile.servicesCatalog || []).slice(0, 40).map((s) => ({ id: s.id, name: s.name, price: s.pricing?.confirmed === false ? null : s.price_range || null }));
  const h = hoursFact(profile);
  const pay = String(profile.businessPolicies?.payment || '').trim().slice(0, 200) || null;
  return { services, hours: h ? h.text : null, payment: pay, business: profile.businessName || null, agent: profile.agentName || null };
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
].join('\n');
const PREFIX = new Map();
const SCHEMA = {
  type: 'object',
  properties: {
    understanding: { type: 'object', properties: {
      lang: { type: 'string', enum: ['en', 'sw', 'mix'] },
      intents: { type: 'array', items: { type: 'string', enum: ['book', 'ask', 'confirm', 'deny', 'cancel', 'reschedule', 'callback', 'take_message', 'goodbye', 'smalltalk', 'add_service', 'give_info'] } },
      slots: { type: 'object', properties: { services: { type: 'array', items: { type: 'string' } }, date: { type: 'string' }, time: { type: 'string' }, places: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } } },
      questions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['coverage', 'price', 'hours', 'identity', 'booking_status', 'payment', 'services', 'other'] }, subject: { type: 'string' } }, required: ['type'] } },
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
    RECEIPTS: { coverage: coverage.places.map((r) => ({ place: r.place, covered: r.covered, fee_kes: r.fee_kes })), this_turn: [] },
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
  if (ti > 0 && ri > ti) { try { out.toolCalls = JSON.parse(`{${buf.slice(ti, ri).replace(/,\s*$/, '')}}`).tool_calls || []; } catch { out.toolCalls = null; } }
  if (ri > 0) { const m = buf.slice(ri).match(/"reply"\s*:\s*"/); const r = readString(buf, ri + m[0].length); out.reply = r.text; out.replyClosed = r.closed; }
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
function runHedged({ streamFor, primaryId, backupId, request, deadlines = DEADLINES, clock = () => Date.now(), onProgress = () => {} }) {
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
      if (!winner && p.understanding) { winner = a; for (const b of attempts) if (b !== a && !b.end) { b.ac.abort(); b.outcome = 'lost_race'; b.end = true; b.ms = clock() - t0 - b.startMs; } clearTimeout(hedgeTimer); }
      if (winner === a) onProgress(a, p);
    } })).then((res) => {
      if (a.end) return;
      if (res && typeof res.text === 'string' && res.text.length > a.buf.length) { a.buf = res.text; }
      a.end = true; a.ms = clock() - t0 - a.startMs;
      let full = null; try { full = JSON.parse(a.buf); } catch { full = null; }
      a.outcome = full && full.understanding && typeof full.reply === 'string' ? 'ok' : 'invalid_json';
      if (a.outcome === 'ok' && (!winner || winner === a)) { winner = a; a.final = full; onProgress(a, { understanding: full.understanding, toolCalls: full.tool_calls || [], reply: full.reply, replyClosed: true }); finish('ok'); return; }
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
const UNSURE = /\b(not sure|can'?t confirm|cannot confirm|don'?t know|sina uhakika|sijui|siwezi kuthibitisha)\b/i;
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
  const prices = new Set(); for (const s of ctx.profile.servicesCatalog || []) for (const n of nums(s.price_range || '')) prices.add(n);
  const known = new Map(ctx.coverage.map((r) => [r.place.toLowerCase(), r]));
  const act = { questions: 0, claimed: false };
  const lockName = CP.lockedName(ctx.machine);
  const cand = ctx.caller.candidate;
  function placesIn(s) {
    const hits = [];
    for (const r of ctx.coverage) if (new RegExp(`\\b${r.place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) hits.push(r);
    if (!hits.length) { for (const p of placeCandidates(s)) { const r = known.get(p.toLowerCase()) || coverageReceipt([p], ctx.profile).places[0]; if (r && !hits.includes(r)) { hits.push(r); if (!known.has(r.place.toLowerCase())) { known.set(r.place.toLowerCase(), r); ctx.coverage.push(r); } } } }
    return hits;
  }
  function check(raw) {
    const s = String(raw || '').trim(); if (!s) return { verdict: 'drop', reason: 'empty' };
    // G2 claims need a receipt from this turn
    if ((CC.CLAIM.test(s) || CLAIM_MORE.test(s)) && !ctx.receipts.length) return { verdict: 'drop', reason: 'claim_without_receipt' };
    // G8 no unasked price (decision 4)
    const priceish = PRICE_WORD.test(s) && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|saa\s/i.test(s) && !/\b(20\d\d|october|oktoba)\b/i.test(s);
    if (priceish && !asked.has('price')) return { verdict: 'drop', reason: 'unasked_price' };
    if (priceish && asked.has('price') && nums(s).some((n) => !prices.has(n))) return { verdict: 'repair', reason: 'price_not_in_kb', subject: 'price', fix: priceFix(ctx) };
    // G3/G4 coverage: polarity must equal the receipt; one answer per place
    const hits = placesIn(s);
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
  if (svc && svc.price_range && svc.pricing?.confirmed !== false) return sw(ctx.lang) ? `${svc.name} ni ${svc.price_range}.` : `${svc.name} is ${svc.price_range}.`;
  return sw(ctx.lang) ? 'Sina bei kamili hapa; timu inaweza kuthibitisha.' : "I don't have the exact price here; the team can confirm.";
}
function identityFix(ctx) {
  const n = CP.lockedName(ctx.machine); const c = ctx.caller.candidate;
  if (n) return sw(ctx.lang) ? `Jina lako ni ${n}.` : `You're ${n}.`;
  if (c) return sw(ctx.lang) ? `Nina jina ${c} hapa. Je, ni wewe?` : `I have ${c} on file. Is that you?`;
  return sw(ctx.lang) ? 'Sina jina lako bado. Naweza kujua jina lako?' : "I don't have your name yet. May I have it?";
}

/** G7: a question the kept reply does not answer gets the code's honest answer (placed before the step question). */
function owedAnswers(ctx, keptText) {
  const out = []; const low = keptText.toLowerCase();
  for (const q of ctx.questions || []) {
    if (q.type === 'coverage') {
      const rows = ctx.coverage.filter((r) => !low.includes(r.place.toLowerCase()));
      const a = coverageAnswer(rows, ctx.lang); if (a) out.push({ subject: 'coverage', text: a });
    } else if (q.type === 'identity') {
      const n = CP.lockedName(ctx.machine) || ctx.caller.candidate;
      if (!n || !low.includes(n.toLowerCase())) out.push({ subject: 'identity', text: identityFix(ctx) });
    } else if (q.type === 'price') {
      if (!PRICE_WORD.test(keptText)) out.push({ subject: 'price', text: priceFix(ctx) });
    } else if (q.type === 'hours') {
      const h = hoursFact(ctx.profile); if (h && !(h.nums || []).some((n) => low.includes(n))) out.push({ subject: 'hours', text: `${h.text}.` });
    } else if (q.type === 'booking_status') {
      const up = ctx.caller.upcoming;
      if (up.length && !up.some((u) => u.service && low.includes(String(u.service).toLowerCase().split(' ')[0]))) out.push({ subject: 'booking_status', text: upcomingLine(up, ctx.lang) });
    }
  }
  // dedupe by subject, and never two coverage lines
  const seen = new Set(); return out.filter((a) => (seen.has(a.subject) ? false : (seen.add(a.subject), true)));
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

module.exports = { leadOn, DEADLINES, UPCOMING_MAX, callerReceipt, placeCandidates, coverageReceipt, coverageAnswer, coverageSentence, kb, contextPack, buildRequest, staticPrefix, partialParse, sentencesOf, runHedged, guardTools, makeVerifier, owedAnswers, openingLine, storedWhenText, compareSaved, turnFieldsOf, identityFix, SCHEMA };
