'use strict';
// One reply writer per model-lead turn: every speech path (model, owed, template, fixed, repair)
// is planned into a single utterance before the first sentence is emitted.
const OW = require('./owed');
const ML = require('./modelLead');
const CP = require('./callPlan');

const NEG = ML.NEG;
const UNSURE = ML.UNSURE;

/** Drop a model sentence that contradicts a yes coverage owed answer on the same place. */
function dropsContradictingCoverage(sentence, owedItems = []) {
  const named = ML.placesNamedInText(sentence);
  if (!named.length) return false;
  const unsure = UNSURE.test(sentence);
  const neg = NEG.test(sentence) && !/\?\s*$/.test(String(sentence).trim());
  if (!unsure && !neg) return false;
  for (const o of owedItems) {
    if (o.topic !== 'coverage' || !o.row || o.row.covered !== 'yes') continue;
    if (named.some((n) => n.toLowerCase() === String(o.row.place).toLowerCase())) return true;
  }
  return false;
}

/**
 * Plan the turn's spoken lines (content, owed merge, step question). Caller emits in order after planning.
 * @returns {{ lines: { text, lang, src }[], answeredBy: string }}
 */
function writeTurn({
  lang,
  ctx,
  st,
  pre,
  fixed,
  tmpl,
  ver,
  modelBuffer = [],
  held = null,
  answeredBy = 'model',
  templateLines = [],
  ck = null,
  split = false,
  repairs = 0,
  modelSentences = 0,
}) {
  const out = [];
  if (answeredBy === 'template' || answeredBy === 'template_vetoed') {
    let base = tmpl;
    if (split && !((ctx.questions || []).some((q) => q.type === 'price'))) base = CP.split(base).filter((x) => !ML.UNASKED_PRICE(x)).join(' ');
    if (templateLines.length && !fixed) base = CP.split(base).filter((x) => /\?\s*$/.test(x) && !/not getting that|sikupati|sijakuelewa/i.test(x)).join(' ');
    if (ctx.plo && ctx.plo.blocked) base = lang === 'sw' ? 'Kazi iko eneo lingine?' : 'Is the job anywhere else?'; // [PROMPT-PLACEHOLDER]
    if (templateLines.some((l) => /\?\s*$/.test(l))) base = CP.split(base).filter((x) => !/\?\s*$/.test(x)).join(' ');
    for (const l of templateLines) out.push({ text: l, lang, src: 'template' });
    out.push({ text: base, lang, src: 'template' });
    return { lines: out, answeredBy };
  }

  const draft = [...modelBuffer.map((x) => x.text), held || ''].join(' ');
  const owed = ML.owedAnswers(ctx, draft);
  for (const part of modelBuffer) {
    if (dropsContradictingCoverage(part.text, owed)) continue;
    out.push({ text: part.text, lang, src: part.src || 'model' });
  }
  for (const a of owed) out.push({ text: a.text, lang, src: 'owed_answer' });

  if (fixed) {
    out.push({ text: st.kind === 'readback' ? st.readback : tmpl, lang, src: 'fixed' });
    if (!modelSentences) answeredBy = 'fixed';
  } else {
    const stepQ = st.kind === 'ask' || st.kind === 'confirm_name' ? CP.tail(st, ver.act) : null;
    if (held) out.push({ text: held, lang, src: 'model' });
    else if (stepQ) out.push({ text: stepQ, lang, src: 'step' });
  }
  if (repairs) answeredBy = `${answeredBy}+repair`;
  return { lines: out, answeredBy };
}

/** Template-fallback owed lines (same collect path as the writer). */
function templateOwedLines(ctx, ck) {
  if (ck === 'clarify') return [];
  return OW.collect({
    questions: ctx.questions || [],
    coverage: ctx.coverage || [],
    text: ctx.text || '',
    profile: ctx.profile || {},
    machine: ctx.machine,
    lang: ctx.lang,
    confirm: ctx.confirm || [],
    policyScan: !ctx.u && ck !== 'request',
  }).map((o) => OW.render(o, ctx)).filter(Boolean);
}

module.exports = { writeTurn, dropsContradictingCoverage, templateOwedLines };
