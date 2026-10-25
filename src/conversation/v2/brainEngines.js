'use strict';
// BRAIN_ENGINES: understanding -> plan -> tools -> handoff -> guarded response.
const { brainEnginesOn } = require('./flag');
const U = require('./understanding');
const { pickGoal, businessOpen } = require('./enginePlan');
const { runTools } = require('./engineTools');
const { commitHandoff } = require('./handoff');
const { makeEnginesVerifier } = require('./engineGuard');
const ML = require('./modelLead');
const CP = require('./callPlan');
const TW = require('./turnWriter');
const { createLiveHandlers } = require('./liveHandlers');
const { runTurnStream } = require('./stream');
const { spoken: spokenStyle } = require('./spokenStyle');
const V1 = require('./v1draft');
const L = require('./lexicon');
const { createHandoffNotifier } = require('./handoffNotify');
const { capSpokenLine, isReadbackOrBooked } = require('./engineInvariants');

function on({ env = process.env, tenantId } = {}) {
  return brainEnginesOn({ env, tenantId });
}

function replyRequest({ goal, receipts, understanding, profile, lang, machine }) {
  const facts = receipts.map((r) => ({ tool: r.tool, text: r.text || r.line_en || r.line_sw || null, place: r.place, covered: r.covered }));
  const pack = {
    GOAL: goal,
    UNDERSTANDING: understanding,
    RECEIPTS: facts,
    LANG: lang,
    PLAN: CP.step(machine, '', lang),
    CALLER: { name: receipts.caller?.name, upcoming: receipts.caller?.upcoming?.length || 0 },
  };
  return ML.replyRequest(pack, profile);
}

async function runBrainEnginesTurn({
  text,
  profile,
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
  machine.engines = true;
  machine.turn = (machine.turn || 0) + 1;
  const understanding = await U.runUnderstanding({
    text,
    machine,
    profile,
    streamFor,
    modelId,
    hardMs: Number(env.BRAIN_ENGINES_UNDERSTAND_MS || 1500),
    clock,
    log,
  });
  const lang = langLock || understanding.language || machine.lang || 'en';
  machine.lang = lang;
  const toolOut = runTools({ understanding, machine, profile, lang, text, now: nowFn() });
  const goal = pickGoal({ understanding, machine, profile, lang, callerPhone: machine.callerPhone, now: nowFn() });
  if (goal.type === 'handoff_commit') {
    const handlers = handlersIn || createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: opts.ctx || {} });
    const notify = opts.notify || createHandoffNotifier(profile, { dispatch: opts.dispatch, machine });
    const committed = await commitHandoff({ machine, profile, handlers, callerPhone: machine.callerPhone, understanding, notify });
    const line = lang === 'sw'
      ? '[PROMPT-PLACEHOLDER] Sawa. Mwenye biashara atakupigie kwa nambari uliyopiga.'
      : '[PROMPT-PLACEHOLDER] Okay. The owner will call you back on the number you called from.';
    return emitTurn({ line, lang, machine, understanding, goal, onSentence, path: 'brain_engines_handoff_done', committed });
  }
  if (goal.type === 'handoff' && (goal.step?.kind === 'readback' || goal.step?.line)) {
    const raw = goal.step.line || '';
    return emitTurn({ line: spokenStyle(raw, lang), lang, machine, understanding, goal, onSentence, path: 'brain_engines_handoff', readback: true });
  }
  if (goal.type === 'handoff' && goal.step?.kind === 'ask_name') {
    const line = goal.step.line || (lang === 'sw' ? '[PROMPT-PLACEHOLDER] Naomba jina lako.' : '[PROMPT-PLACEHOLDER] May I have your name?');
    return emitTurn({ line: spokenStyle(line, lang), lang, machine, understanding, goal, onSentence, path: 'brain_engines_handoff' });
  }
  const handlers = handlersIn || createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: opts.ctx || {} });
  let tmpl = '';
  if (goal.type === 'readback' && machine.pending) {
    tmpl = CP.readbackLine(machine, lang) || machine.pending.readbackLine || '';
  } else if (goal.type === 'ask') {
    const st = { kind: 'ask', slot: goal.slot, question: slotQuestion(goal.slot, lang), lang };
    tmpl = st.question;
  }
  const request = replyRequest({ goal, receipts: toolOut.receipts, understanding, profile, lang, machine });
  let liveReply = '';
  const receiptLine = (understanding.answers?.includes('coverage')
    ? toolOut.receipts.find((r) => r.tool === 'coverage' && r.text)?.text
    : null) || toolOut.receipts.filter((r) => r.text).map((r) => r.text)[0] || '';
  const skipReplyModel = goal.type === 'answer' && receiptLine;
  if (streamFor && modelId && !skipReplyModel) {
    try {
      const res = await streamFor(modelId)({ request, signal: undefined, onText: (d) => { liveReply += d; } });
      if (res?.text) {
        try {
          const j = JSON.parse(res.text);
          liveReply = j.reply || liveReply;
        } catch {
          liveReply = res.text;
        }
      }
    } catch { liveReply = ''; }
  }
  if (skipReplyModel) {
    const line = capSpokenLine(spokenStyle(receiptLine, lang));
    if (goal.type === 'answer' && understanding.answers?.includes('hours') && !businessOpen(profile, nowFn())) {
      machine._enginesOfferCallback = true;
    }
    V1.remember(machine, 'agent', line);
    if (typeof onSentence === 'function') onSentence({ text: line, lang });
    return { line, lang, sentences: [{ text: line, lang, src: 'receipt' }], path: 'brain_engines', understanding, goal, lead: true, answeredBy: 'receipt' };
  }
  const st = CP.step(machine, tmpl, lang);
  const ctx = {
    st,
    receipts: [],
    coverage: toolOut.receipts.filter((r) => r.tool === 'coverage'),
    caller: toolOut.caller,
    profile,
    questions: (understanding.answers || []).map((a) => ({ type: a })),
    lang,
    machine,
    text,
    u: understanding,
    confirm: [],
  };
  const ver = makeEnginesVerifier(ctx);
  const modelBuffer = [];
  for (const s of ML.sentencesOf(liveReply, true)) {
    const v = ver.check(s);
    if (v.verdict === 'drop') continue;
    modelBuffer.push({ text: v.text || s, src: v.verdict === 'pass' ? 'model' : 'repair' });
  }
  const plan = TW.writeTurn({
    lang,
    ctx,
    st,
    pre: { owned: false },
    fixed: goal.type === 'readback',
    tmpl: tmpl || liveReply,
    ver,
    modelBuffer,
    held: null,
    answeredBy: 'model',
    templateLines: [],
    split: false,
    repairs: 0,
    modelSentences: modelBuffer.length,
  });
  const spoken = [];
  for (const line of plan.lines) {
    if (shouldAbort()) break;
    const t = spokenStyle(line.text, lang);
    spoken.push({ text: t, lang, src: line.src });
    if (typeof onSentence === 'function') onSentence({ text: t, lang });
  }
  let line = capSpokenLine(spoken.map((x) => x.text).join(' ').trim() || tmpl, { readbackOrBooked: goal.type === 'readback' });
  if (!line.trim()) {
    line = lang === 'sw' ? '[PROMPT-PLACEHOLDER] Sawa.' : '[PROMPT-PLACEHOLDER] Okay.';
  }
  V1.remember(machine, 'agent', line);
  if (goal.type === 'answer' && understanding.answers?.includes('hours') && !businessOpen(profile, nowFn())) {
    machine._enginesOfferCallback = true;
  }
  (machine.trace || (machine.trace = [])).push({ turn: machine.turn, brain_engines: { understanding, goal, receipts: toolOut.receipts } });
  return { line, lang, sentences: spoken, path: 'brain_engines', understanding, goal, lead: true, answeredBy: 'model' };
}

function slotQuestion(slot, lang) {
  const sw = L.isSw(lang);
  if (slot === 'name') return sw ? '[PROMPT-PLACEHOLDER] Naomba jina lako?' : '[PROMPT-PLACEHOLDER] May I have your name?';
  if (slot === 'date') return sw ? '[PROMPT-PLACEHOLDER] Ni siku gani?' : '[PROMPT-PLACEHOLDER] Which day works for you?';
  if (slot === 'time') return sw ? '[PROMPT-PLACEHOLDER] Saa ngapi?' : '[PROMPT-PLACEHOLDER] What time works?';
  if (slot === 'place') return sw ? '[PROMPT-PLACEHOLDER] Mahali ni wapi?' : '[PROMPT-PLACEHOLDER] Where is the job?';
  if (slot === 'service') return sw ? '[PROMPT-PLACEHOLDER] Huduma gani?' : '[PROMPT-PLACEHOLDER] Which service?';
  return sw ? '[PROMPT-PLACEHOLDER] Tukusaidie vipi?' : '[PROMPT-PLACEHOLDER] How can I help?';
}

function emitTurn({ line, lang, machine, understanding, goal, onSentence, path, readback = false, committed = null }) {
  const capped = capSpokenLine(line, { readbackOrBooked: readback || isReadbackOrBooked(line) });
  V1.remember(machine, 'agent', capped);
  if (typeof onSentence === 'function') onSentence({ text: capped, lang });
  return { line: capped, lang, sentences: [{ text: capped, lang, src: 'fixed' }], path, understanding, goal, lead: true, answeredBy: 'fixed', committed };
}

module.exports = { on, runBrainEnginesTurn, replyRequest };
