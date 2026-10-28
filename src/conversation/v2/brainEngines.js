'use strict';
// BRAIN_ENGINES (default off): understanding -> plan -> tools -> (commit gate) -> response -> guard -> speakable.
//   1. Understanding first: ONE typed model call per turn, hard cap (BRAIN_ENGINES_UNDERSTAND_MS, 1500),
//      no backup race; a meaningful filler only if the wait passes BRAIN_ENGINES_FILLER_MS (700, clamped to 850).
//      The turn language is decided once here and every line of the turn obeys it.
//   2. Plan: one goal; slot preconditions before any write; pending read-back answered first.
//   3. Response: the model writes every line except the read-back and the write-outcome line.
//   4. Commit truth (single check): no booked/saved/callback claim without a committed write (row id + receipt).
//   5. Speakable: no bracketed tag ever reaches TTS; spoken dates and times.
//   6. One trace record per turn (understanding, goal, tool, write, guard, timings) via onModelStage.
const { brainEnginesOn } = require('./flag');
const U = require('./understanding');
const { pickGoal } = require('./enginePlan');
const { runTools } = require('./engineTools');
const { bindCallerName, initHandoff } = require('./handoff');
const { makeEnginesVerifier, allowedTimes } = require('./engineGuard');
const ML = require('./modelLead');
const V1 = require('./v1draft');
const { createLiveHandlers } = require('./liveHandlers');
const { createHandoffNotifier } = require('./handoffNotify');
const { capSpokenLine } = require('./engineInvariants');
const { commitWrite, enforceCommitTruth, engState } = require('./engineCommit');
const Lines = require('./engineLines');
const { writeReply } = require('./engineReply');
const { speakable } = require('./engineSpeech');
const { pickFiller, fillerDelayMs } = require('./engineFiller');
const { buildTrace, emitTrace } = require('./engineTrace');

const ACK_ONLY = /^\W*(ok(?:ay)?|sawa|haya|poa|yes|yeah|yep|no|nope|ndio|ndiyo|hapana|eeh|sure|thanks?|thank you|asante(?: sana)?|alright)\W*$/i;

function on({ env = process.env, tenantId } = {}) {
  return brainEnginesOn({ env, tenantId });
}

/** The turn language, decided once. A bare ack/yes/no or a name keeps the language the call is in. */
function decideLang({ u, text, prev, langLock }) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const base = prev || langLock || null;
  if (base && (ACK_ONLY.test(t) || (words <= 3 && !U.textLang(t)))) return base;
  if (u && u.source === 'model' && (u.language === 'en' || u.language === 'sw')) return u.language;
  return U.textLang(t) || base || 'en';
}

function sentencesOf(line) {
  return ML.sentencesOf(String(line || ''), true).map((x) => String(x).trim()).filter(Boolean);
}

async function runBrainEnginesTurn({
  text,
  profile = {},
  machine,
  env = process.env,
  streamFor,
  modelId,
  langLock,
  shouldAbort = () => false,
  onSentence,
  applyTools,
  opts = {},
  handlers: handlersIn,
}) {
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const nowFn = typeof opts.now === 'function' ? opts.now : opts.now ? () => new Date(opts.now) : () => new Date();
  const log = opts.log || (() => {});
  const T0 = clock();
  const now = nowFn();
  machine.engines = true;
  machine.turn = (machine.turn || 0) + 1;
  const E = engState(machine);
  initHandoff(machine);
  const handlers = handlersIn || createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: opts.ctx || {} });
  const callerPhone = machine.callerPhone || opts.ctx?.callerPhone || null;
  const timings = {};
  let filler = null;
  const prevLang = E.lang || null;
  const streaming = typeof onSentence === 'function';

  // 1) understanding first. One turn-level filler timer covers the WHOLE wait before the first real word
  // (understanding + reply + write): it fires once at BRAIN_ENGINES_FILLER_MS only if nothing was said yet.
  const fillerMs = fillerDelayMs(env);
  let spokeReal = false; let turnLang = null;
  const fireFiller = () => {
    if (spokeReal || filler || shouldAbort()) return;
    const fl = turnLang || prevLang || langLock || U.textLang(text) || 'en';
    const line = pickFiller(text, fl, { profile, machine, now });
    if (!line) return;
    const atMs = clock() - T0;
    filler = { text: line, atMs, lang: fl };
    timings.fillerMs = atMs;
    // at most once per turn; uncuttable = our own reply never cuts it mid-phrase (caller barge-in is Voice's call)
    onSentence({ text: line, lang: fl, filler: true, uncuttable: true });
  };
  const fillerTimer = streaming && fillerMs > 0 ? setTimeout(fireFiller, fillerMs) : null;
  if (fillerTimer && fillerTimer.unref) fillerTimer.unref();
  try {
  const u = await U.runUnderstanding({
    text, machine, profile, streamFor, modelId, clock, log, now,
    hardMs: Number(env.BRAIN_ENGINES_UNDERSTAND_MS || 1500),
  });
  timings.understandMs = u._ms;
  const lang = decideLang({ u, text, prev: prevLang, langLock });
  E.lang = lang; machine.lang = lang; u.language = lang; turnLang = lang;

  // 2) plan: exactly one goal
  let goal = pickGoal({ understanding: u, machine, profile, lang, callerPhone, now, text });
  // 3) read-only tools for this turn's facts
  const toolOut = runTools({ understanding: u, machine, profile, lang, text, now });
  const receipts = toolOut.receipts.filter((r) => r.tool !== 'lookup_caller');
  // v2 KB: lookup timing + what kind of catalogue answer this turn carried (trace only)
  const kbr = receipts.find((r) => r.kb);
  if (kbr) { timings.kbLookupMs = kbr.ms; timings.kbKind = kbr.kind; timings.kbVersion = kbr.kbVersion ?? null; }
  // a catalogue question the understanding missed ("what tomato seedlings do you have") is answered, not met with an open line
  if (kbr && kbr.text && goal.type === 'open') goal = { type: 'answer', topics: ['services'], answers: ['services'], offerCallback: false };

  const fixed = []; const model = []; const guard = []; let write = null; let path = 'brain_engines';
  // 4a) the write (only on a yes to the read-back the caller heard)
  if (goal.type === 'commit') {
    const p = goal.p;
    const notify = opts.notify || (opts.dispatch ? createHandoffNotifier(profile, { dispatch: opts.dispatch, machine }) : null);
    const res = await commitWrite({ p, machine, handlers, profile, notify, callerPhone, log });
    write = { status: res.status, id: res.id || null, fallbackId: res.fallbackId || null, notified: !!res.notified, error: res.error || null, idempotencyKey: p.idemKey };
    if (res.status === 'blocked') {
      goal = { type: 'ask', slot: res.missing[0], why: p.tool === 'create_handoff' ? 'callback' : 'booking', answers: goal.answers };
    } else {
      path = 'brain_engines_commit';
      E.pending = null;
      E.flow = null;
      if (res.status === 'committed') {
        if (p.name) bindCallerName(machine, handlers, p.name);
        if (p.tool === 'create_handoff') Object.assign(machine.handoff, { committed: true, phase: 'done', reason: p.reason, idempotencyKey: p.idemKey });
        if (p.tool === 'create_booking') machine.intent = null;
        fixed.push({ text: Lines.committedLine(p, lang), src: 'booked' });
      } else {
        if (p.tool === 'create_booking') machine.intent = null;
        fixed.push({ text: Lines.failedLine(p, res.status, lang), src: 'write_failed' });
      }
    }
  }
  if (goal.type === 'readback') {
    E.pending = { p: goal.p, reasks: 0, heardOk: true, issuedTurn: machine.turn };
    try { require('./commitSafety').makeRecorder(handlers, machine)('proposed', goal.p); } catch { /* receipts never block */ }
    fixed.push({ text: Lines.readbackLine(goal.p, lang), src: 'readback' });
  } else if (goal.type === 'reask') {
    fixed.push({ text: Lines.reaskLine(goal.p, lang), src: 'readback' });
  }

  // 4b) model-written lines (everything except the read-back and the outcome line)
  const modelGoal = ['answer', 'ask', 'open', 'close', 'no_name'].includes(goal.type)
    || ((goal.type === 'readback' || goal.type === 'reask') && (goal.answers || []).length > 0);
  if (modelGoal) {
    const rep = await writeReply({
      goal, text, receipts, machine, profile, lang, caller: toolOut.caller, streamFor, modelId, clock, log,
      hardMs: Number(env.BRAIN_ENGINES_REPLY_MS || 2500),
    });
    timings.replyMs = rep.ms; timings.replyOutcome = rep.outcome;
    const ctx = {
      st: { kind: 'answer', items: [], lang },
      receipts: [],
      coverage: receipts.filter((r) => r.tool === 'coverage' && r.place),
      caller: toolOut.caller,
      profile,
      questions: (u.answers || []).map((a) => ({ type: a })),
      lang, machine, text, u, confirm: [],
      kbReceipt: (receipts.find((r) => r.kb && r.text) || {}).text || null,
    };
    const allowed = allowedTimes({ receipts, machine, profile, extra: E.pending?.p?.callbackWhen?.at ? [E.pending.p.callbackWhen.at.time] : [] });
    const ver = makeEnginesVerifier(ctx, { allowed, readbackTurn: goal.type === 'readback' || goal.type === 'reask' });
    for (const s of sentencesOf(rep.text)) {
      const v = ver.check(s);
      guard.push({ verdict: v.verdict, reason: v.reason || null });
      if (v.verdict === 'drop') continue;
      model.push({ text: v.text || s, src: v.verdict === 'pass' ? 'model' : 'repair' });
    }
    // model unavailable or every sentence dropped: grounded receipt fact / plain ask (total fallback, traced)
    if (!model.length && !fixed.length) {
      let receiptText = goal.type === 'answer' ? receipts.filter((r) => r.text).map((r) => r.text).slice(0, 2).join(' ') : null;
      // never the same fact line twice in a row: an unanswered price gets the honest unknown instead
      if (receiptText && receiptText === machine.lastLine) receiptText = (u.answers || []).includes('price') ? (E.offered = 'callback', E.offeredTurn = machine.turn, require('./receipts').info({ kind: 'price', found: false }, lang)) : null;
      const n = goal.type === 'open' ? (E.openFallbacks = (E.openFallbacks || 0) + 1) - 1 : (goal.n || 0);
      const fb = Lines.noModelFallback(goal, lang, { n, machine, receiptText });
      // v2 KB: an ask turn that also carried a catalogue question answers it first (model unavailable only)
      const kbFirst = goal.type === 'ask' && kbr && kbr.text && (goal.answers || []).length ? kbr.text : null;
      if (kbFirst) model.push({ text: /\?\s*$/.test(kbFirst) ? kbFirst : `${kbFirst} ${fb || ''}`.trim(), src: 'receipt' });
      else if (fb) model.push({ text: fb, src: receiptText ? 'receipt' : 'fallback' });
    } else if (goal.type === 'ask' && !model.some((x) => /\?\s*$/.test(x.text))) {
      model.push({ text: Lines.noModelFallback(goal, lang, { n: goal.n || 0, machine }), src: 'tail' });
    }
    if (goal.type === 'answer' && goal.offerCallback) { E.offered = 'callback'; E.offeredTurn = machine.turn; }
    // v2 KB: a custom-quote / site-visit price offers to take details; the caller's yes starts the callback capture
    const kbCap = receipts.find((r) => r.kb && r.capture);
    if (kbCap) {
      E.offered = 'callback'; E.offeredTurn = machine.turn;
      // a paused item is never a booking slot: a yes is a callback for when it's back (traced, read back like any callback)
      if (kbCap.capture === 'when_back') machine.kbWhenBack = kbCap.service || null;
      else if (kbCap.service && machine.slots && !machine.slots.service) machine.slots.service = kbCap.service;
    }
  }

  // 5) assemble: model part capped at two sentences, then the fixed line; one commit-truth check for all
  const modelCapped = sentencesOf(capSpokenLine(model.map((x) => x.text).join(' ')));
  const parts = [
    ...modelCapped.map((t) => ({ text: t, src: (model.find((m) => m.text.includes(t)) || {}).src || 'model' })),
    ...fixed.flatMap((f) => sentencesOf(f.text).map((t) => ({ text: t, src: f.src }))),
  ];
  const truth = enforceCommitTruth(parts, E.ledger);
  const stripped = [];
  const out = [];
  for (const s of truth.kept) {
    const sp = speakable(s.text, lang);
    if (sp.stripped.length) stripped.push(...sp.stripped);
    if (sp.text) out.push({ text: sp.text, lang, src: s.src });
  }
  if (!out.length) {
    const sp = speakable(Lines.noModelFallback(goal, lang, { machine }), lang);
    out.push({ text: sp.text, lang, src: 'fallback' });
  }
  if (stripped.length) log(`[brain_engines] ASSERT stripped bracketed tag(s) before TTS: ${stripped.join(' ')}`);

  // 6) speak once, in order
  const spoken = [];
  for (const s of out) {
    if (shouldAbort()) break;
    if (timings.firstWordMs == null) timings.firstWordMs = clock() - T0;
    if (!spokeReal) { spokeReal = true; if (fillerTimer) clearTimeout(fillerTimer); }
    spoken.push(s);
    if (streaming) onSentence({ text: s.text, lang });
  }
  const line = spoken.map((x) => x.text).join(' ').trim();
  machine.lastLine = line;
  machine.phase = E.pending ? 'readback' : 'collect';
  V1.remember(machine, 'agent', line);
  timings.totalMs = clock() - T0;
  const end = goal.type === 'close' && !E.pending;
  const answeredBy = spoken.some((x) => x.src === 'model' || x.src === 'repair') ? 'model' : (spoken[0] && spoken[0].src) || 'fallback';
  const rec = buildTrace({
    turn: machine.turn,
    turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null,
    u, lang, goal, write, guard, dropped: truth.dropped, filler, timings, stripped, path,
  });
  emitTrace(rec, { machine, onStage: opts.onModelStage, log });
  return {
    line, lang, sentences: spoken, path, understanding: u, goal, lead: true, answeredBy,
    streamed: streaming, phase: machine.phase, end, ...(end ? { reason: 'caller_done' } : {}),
    write, filler: filler ? filler.text : null, timings,
  };
  } finally {
    spokeReal = true;
    if (fillerTimer) clearTimeout(fillerTimer);
  }
}

module.exports = { on, runBrainEnginesTurn, decideLang };
