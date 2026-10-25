'use strict';
// BRAIN_CALL_CORE (off|on; Done & Dusted only, needs BRAIN_V1_DRAFT=on + BRAIN_V1_DRAFT_PHASE_A=on).
// Design: voice-qa/2026-10-25_root-cause-architecture.md (Alvin pt334u, decisions 1-5).
// One call core per turn:
//   events   - the caller turn as typed events (yes/no, asks, book-switch, name-yes), ONE yes table (CP.isYes)
//   reducer  - the core is the only state writer: call plan + machine run here; the composer writes nothing
//   receipts - every action runs through a tool that returns a receipt (machine.receipts); no receipt, no claim
//   plan     - ReplyPlan: answer every caller question first, then ONE next ask (the step)
//   composer - the model phrases the plan; the template composer renders the SAME plan (timeouts, drops)
//   verifier - only plan content passes; "booked/noted/they'll call you/done" needs a receipt this turn
//   trace    - R0: events, state writes, stage timings, the plan, receipts (onModelStage kind=call_core)
// Off = today's Phase B exactly. Caller-facing lines: [PROMPT-PLACEHOLDER].
const CP = require('./callPlan');
const V1 = require('./v1draft');
const AC = require('./areaCoverage');
const L = require('./lexicon');
const { hoursFact } = require('./v1draftFacts');
const OF = require('./ownerFacts');

function coreOn({ env = process.env, tenantId } = {}) {
  return V1.phaseA({ env, tenantId }) && String(env.BRAIN_CALL_CORE || 'off').trim().toLowerCase() === 'on';
}

const sw = (lang) => L.isSw(lang);
const isQ = (s) => /\?\s*$/.test(String(s || '').trim());
const QUESTIONISH = /\?|^\W*(where|what|which|how|when|why|do you|does|can you|can i|are you|is it|wapi|nini|je|ngapi|mnafika|mnafanya|mnapokea|naweza)\b|\b(do you|can i|how much|mnafika|mnapokea|bei gani|ni ngapi)\b/i;
const COVER = /\b(do you (?:do|cover|come|serve|reach|go)|cover|coverage|come to|serve|areas?|mnafika|mnakuja|mtafika|maeneo|mnafanya kazi)\b/i;
const PAY = /\b(pay|payment|paying|accept|crypto|bitcoin|usdt|visa|m-?pesa|lipa|malipo|mnapokea|mnakubali|cash|card)\b/i;
const PRICE = /\b(how much|price|prices|cost|costs|charge|bei|gharama|ni ngapi|pesa ngapi)\b/i;
const HOURS = /\b(what time do you (?:open|close)|opening hours|hours|are you open|mnafungua|mnafunga|mko wazi)\b/i;
const BOOK = /\b(book|booking|make a booking|schedule|nataka kubook|kubook|nibook|nipangie)\b/i;
const CANCEL = /\b(cancel|ghairi|futa|sitisha)\b/i;
// claims that need an action receipt this turn (Alvin decision 2: hard rule, always on)
const CLAIM = /\b(booked|confirmed|scheduled|reserved|noted|logged|passed (?:it |that |this )?on|cancell?ed|(?:it'?s|that'?s|all) done|(?:will|'ll) (?:call|ring|phone|reach|get back to) you|someone will|(?:the )?team will|they(?:'ll| will) (?:call|reach|get back)|nimekubook|nimeandika|nimepitisha|watakupigia|tutakupigia|atakupigia|nimeghairi|imeghairiwa|nimeweka|imethibitishwa|nimekuwekea)\b/i;

/** The caller turn as typed events. Rules only (no model on the critical path); the turn model's fields add asks. */
function events(text, machine, profile = {}, fields = null) {
  const t = String(text || '');
  const ev = [];
  if (CP.isYes(t)) ev.push({ type: 'yes' });
  if (/^\W*(no|nope|hapana|si mimi|sio)\b/i.test(t)) ev.push({ type: 'no' });
  const q = QUESTIONISH.test(t);
  const fa = (fields && fields.asks) || [];
  const placeQ = q && !PAY.test(t) && !PRICE.test(t) && (() => { const r = t ? AC.resolve(t, profile) : null; return !!(r && r.status !== 'unknown'); })();
  if ((q && COVER.test(t)) || placeQ || fa.includes('place')) ev.push({ type: 'ask', ask: 'coverage' });
  if (q && PAY.test(t)) ev.push({ type: 'ask', ask: 'pay' });
  if ((q && PRICE.test(t)) || fa.includes('price')) ev.push({ type: 'ask', ask: 'price' });
  if (q && HOURS.test(t)) ev.push({ type: 'ask', ask: 'hours' });
  if (machine && ['cancel', 'change'].includes(machine.intent) && BOOK.test(t) && !CANCEL.test(t)) ev.push({ type: 'intent_switch', to: 'book' });
  return ev;
}

// Swahili callback verbs the shared nlu table misses ("Mnaweza kunipigia?"); normalised for the reducer only
const SW_CALLBACK = /\b(kunipigia|mtanipigia|mnanipigia|unipigie|mnaweza kunipigia simu)\b/gi;
function normalize(text) { return String(text || '').replace(SW_CALLBACK, 'nipigie'); }

/** Reducer pre-step: the book-switch (HD_dad646cd9761 T10) drops the stale cancel/change before the machine runs. */
function applyPre(machine, evs) {
  const writes = [];
  if (evs.some((e) => e.type === 'intent_switch')) {
    writes.push({ key: 'intent', from: machine.intent, to: null });
    machine.intent = null; machine.pending = null; machine.phase = 'collect'; machine.expecting = null;
    if (machine.slots) { machine.slots.row = null; machine.slots.new_when = { date: null, time: null }; }
  }
  return writes;
}

/** Answers from knowledge for each caller question (areaPicks resolver for places, owner facts otherwise). */
function answers(evs, text, machine, profile = {}, lang = 'en', { already = [] } = {}) {
  const out = [];
  const asks = new Set(evs.filter((e) => e.type === 'ask').map((e) => e.ask));
  if (asks.has('coverage')) {
    const r = AC.resolve(text, profile);
    if (r && (r.status !== 'unknown' || r.via === 'unconfirmed')) out.push({ ask: 'coverage', text: AC.line(r, lang), keys: [r.name.toLowerCase()] });
    else if (!r && AC.picksPending(profile)) out.push({ ask: 'coverage', text: sw(lang) ? 'Timu itathibitisha maeneo tunayofika.' : 'The team will confirm the areas we cover.', keys: [] });
    else if (!r) {
      const areas = require('../listedAreas').listedAreaRows(profile).map((x) => x.name);
      if (areas.length) out.push({ ask: 'coverage', text: sw(lang) ? `Tunafika ${areas.join(', ')}.` : `We cover ${areas.slice(0, -1).join(', ')}${areas.length > 1 ? ', and ' : ''}${areas[areas.length - 1]}.`, keys: [areas[0].toLowerCase()] });
    }
  }
  if (asks.has('pay')) {
    const raw = String((OF.ownerFacts(profile).byTopic.get('payment') || {}).text || '').trim();
    const first = (raw.match(/[^.]+(?:\.\d+[^.]*)*\.?/) || [''])[0].trim().replace(/\.$/, '');
    const what = first.replace(/^(you can pay|we accept|payment is|pay)\s*(by|with|via|through)?\s*/i, '');
    const key = ['m-pesa', 'mpesa', 'cash', 'bank', 'card', 'airtel'].find((k) => raw.toLowerCase().includes(k));
    if (what) out.push({ ask: 'pay', text: sw(lang) ? `Malipo ni kwa ${what}.` : `You can pay by ${what}.`, keys: [key || what.split(/\s+/)[0].toLowerCase()] });
    else out.push({ ask: 'pay', text: sw(lang) ? 'Sina maelezo ya malipo hapa sasa hivi.' : "I don't have the payment details here right now.", keys: [] });
  }
  if (asks.has('price')) {
    const rows = CP.matchServices(text, profile);
    const svc = rows[0] || (profile.servicesCatalog || []).find((s) => s.name === (machine.slots && machine.slots.service));
    const priced = svc && svc.pricing?.confirmed !== false && svc.price_range;
    if (priced) out.push({ ask: 'price', text: sw(lang) ? `${svc.name} ni ${svc.price_range}.` : `${svc.name} is ${svc.price_range}.`, keys: [(String(svc.price_range).match(/\d[\d,]*/) || [''])[0]] });
  }
  if (asks.has('hours')) {
    const h = hoursFact(profile);
    if (h) out.push({ ask: 'hours', text: `${h.text}.`, keys: (h.nums || []).slice(0, 1) });
  }
  // owner policies + FAQs (ownerFacts.js, the shared projection): any topic the caller asks about
  if (asks.size || QUESTIONISH.test(text) || /\b(want(?:ed)? to (?:know|ask)|tell me|what about|what if|nataka kujua|niambie)\b/i.test(text)) {
    const of = OF.ownerFacts(profile);
    for (const f of OF.match(text, of).slice(0, 2)) {
      if (f.family === 'payment' && asks.has('pay')) continue;
      const line = OF.spoken(f, lang);
      if (!line) continue;
      out.push({ ask: `owner:${f.topic}`, text: line, keys: [(OF.sentences(line)[0] || line).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)[0] || ''].filter(Boolean), fact: f.id });
    }
  }
  return out;
}

/** Receipts written this turn (machine.receipts since the turn began); ok ones back a claim. */
function receiptsSince(machine, n0) { return (machine.receipts || []).slice(n0).filter((r) => r && r.ok); }

/**
 * The ReplyPlan and its gates. tmpl = the reducer's template line (machine/call plan), st = CP.step().
 * Returns { template, check, tail, plan }: template = answers + lead + template line (the template composer).
 */
function replyPlan({ st, tmpl, ans: ans0, lead, receipts, lang, profile = null }) {
  const of = profile ? OF.ownerFacts(profile) : null;
  let ans = ans0;
  const covered = new Set();
  const hasKey = (s, a) => !a.keys.length || a.keys.some((k) => k && String(s).toLowerCase().includes(k));
  if (lead) { const nm = (String(lead).match(/[A-Z][a-z]{2,}/g) || []).filter((w) => !/^(Welcome|Karibu|Back|Tena)$/.test(w)).pop(); ans = [{ ask: 'lead', text: lead, keys: nm ? [nm.toLowerCase()] : [] }, ...ans]; }
  const has = (line, a) => a.keys.length && hasKey(line || '', a);
  // spoken path: the step question/read-back is what the composer is held to, so an answer it lacks is owed
  const need = ans.filter((a) => !has(st.kind === 'readback' ? st.readback : st.question, a));
  // template path: the reducer's line plus any answer it lacks (same plan, no model)
  const template = [...ans.filter((a) => !has(tmpl, a)).map((a) => a.text), tmpl].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const outstanding = () => need.filter((a) => !covered.has(a.ask));
  const mark = (s) => { for (const a of need) if (a.keys.length && hasKey(s, a)) covered.add(a.ask); };
  function check(s, act) {
    const t = String(s || '').trim();
    if (CLAIM.test(t) && !receipts.length) return { verdict: 'drop', reason: 'claim_without_receipt' };
    // shared owner-fact check (ownerFacts.js): a policy number must come from the owner's facts
    const pc = of ? OF.checkPolicySentence(t, of, lang) : null;
    if (pc) return { verdict: 'replace', text: pc.fix, reason: pc.reason };
    const g = CP.actCheck(t, st, act);
    if (g.verdict === 'drop') return g;
    let final = g.verdict === 'replace' ? g.text : t;
    if (isQ(final) && outstanding().length) { final = `${outstanding().map((a) => a.text).join(' ')} ${final}`; }
    mark(final);
    for (const a of need) if (!a.keys.length && isQ(final)) covered.add(a.ask);
    return final === t ? { verdict: 'pass', text: t } : { verdict: 'replace', text: final, reason: g.reason || 'answer_first' };
  }
  function tail(act) {
    const step = CP.tail(st, act);
    const o = outstanding().map((a) => a.text);
    return [...o, step].filter(Boolean).join(' ');
  }
  const plan = { answers: ans.map((a) => ({ ask: a.ask, text: a.text })), step: st.kind, slot: st.slot || null, question: st.question || null, readback: st.kind === 'readback' ? st.readback : null, receipts: receipts.map((r) => r.tool || r.action), lang };
  const note = `${CP.stepNote(st)}\nANSWER FIRST (exact facts, in your own words, before the question): ${need.length ? need.map((a) => `"${a.text}"`).join(' ') : '(none)'}\nNever say booked, noted, done, cancelled or that anyone will call unless RECEIPTS lists it. RECEIPTS: ${plan.receipts.length ? plan.receipts.join(', ') : '(none)'}`;
  return { template, check, tail, plan, note };
}

function snapshot(m) { return JSON.stringify({ phase: m.phase, expecting: m.expecting, intent: m.intent, slots: m.slots, pending: m.pending && m.pending.tool, offer: m.offer || null, name: m.slots && m.slots.nameConfirmed }); }
function diff(a, b) { if (a === b) return []; const A = JSON.parse(a); const B = JSON.parse(b); return Object.keys(B).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])).map((k) => ({ key: k, to: B[k] })); }

/** Caller-file tool (Alvin decision 5): the existing caller file, read through the core, never rebuilt. */
function callerFileTool(machine) {
  const f = machine.file || {};
  const AM = require('./audibleMouth');
  return { tool: 'lookup_file', ok: true, name: f.nameConfirmed ? f.contactName : null, candidate: !f.nameConfirmed ? f.contactName || null : null, lastJob: AM.lastJobRow(f) || null, upcoming: (f.openRows || []).length };
}

module.exports = { normalize, coreOn, events, applyPre, answers, receiptsSince, replyPlan, snapshot, diff, callerFileTool, CLAIM, BOOK, CANCEL };
