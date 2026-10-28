'use strict';
// Scripted text-mode test through the LIVE new brain (BRAIN_ENGINES turn: understanding -> plan -> tools -> reply -> guard).
// Writes are refused (applyTools returns nothing), so a test never books, saves or notifies. One fresh call per script.
const BE = require('../../conversation/v2/brainEngines');
const { createLiveHandlers } = require('../../conversation/v2/liveHandlers');
const ML = require('../../conversation/v2/modelLead');

/** Utterances built from this business's KB (+ optional extras, e.g. KB_TEXT_TESTS on staging). */
function buildScript(profile, extras = []) {
  const kb = profile && profile.kb && profile.kb.handle;
  const out = [];
  if (kb) {
    const cats = [...kb.categories].filter((c) => c.name && c.count > 1).sort((a, b) => b.count - a.count);
    const big = cats[0];
    const it = kb.doc.items.find((x) => x.price.say_en) || kb.doc.items[0];
    if (big) { out.push({ text: `What ${big.name.toLowerCase()} do you have?`, expect: 'list' }); out.push({ text: `How much is ${big.name.toLowerCase()}?`, expect: 'price_group' }); }
    if (it) { out.push({ text: `How much is ${it.name}?`, expect: 'price_item', item: it.id }); out.push({ text: `Bei ya ${it.name} ni ngapi?`, expect: 'price_item', item: it.id, lang: 'sw' }); }
  }
  const served = (profile.areaPicksRows || []).find((p) => p.serve && p.confirmed_at && /:/.test(p.node));
  if (served) out.push({ text: `Do you cover ${served.node.split(':').pop().replace(/\b\w/g, (c) => c.toUpperCase())}?`, expect: 'coverage' });
  if (profile.hoursSchedule && profile.hoursSchedule.days) out.push({ text: 'Are you open today?', expect: 'hours' });
  for (const t of extras || []) if (t && typeof t === 'string') out.push({ text: t, expect: 'any', extra: true });
  return out.slice(0, 12);
}

function grade(t, r, profile) {
  const line = String(r.line || '');
  const sents = ML.sentencesOf(line, true).filter(Boolean);
  const kb = profile.kb && profile.kb.handle;
  const names = kb ? kb.doc.items.filter((x) => x.say_en.length >= 4 && line.toLowerCase().includes(x.say_en.toLowerCase())).length : 0;
  const problems = [];
  if (!line) problems.push('silent');
  if (sents.length > 3) problems.push(`sentences:${sents.length}`);
  if (names > 3) problems.push(`names:${names}`);
  if ((line.match(/\?/g) || []).length > 1) problems.push('two_questions');
  if (t.expect === 'list' && /shilling|shilingi|ksh/i.test(line)) problems.push('price_in_list');
  return { ok: problems.length === 0, problems, sentences: sents.length, names };
}

/**
 * @param {{ profile, streamFor, modelId, env?, now? }} o  profile must have profile.kb attached
 * @returns {Promise<Array<{text, line, ok, problems, ms, path, model}>>}
 */
async function runTextTests({ profile, streamFor = null, modelId = null, env = process.env, script = null, extras = [], now = new Date() } = {}) {
  const tests = script || buildScript(profile, extras);
  const out = [];
  for (const t of tests) {
    const machine = { slots: {}, file: {}, turn: 0, callerPhone: null };
    const handlers = createLiveHandlers({ applyTools: async () => ({ results: [] }), ctx: {} });
    const t0 = Date.now();
    let r = null; let err = null;
    try {
      r = await BE.runBrainEnginesTurn({ text: t.text, profile, machine, env, streamFor, modelId, langLock: t.lang || null, handlers, opts: { now: () => now } });
    } catch (e) { err = String(e && e.message || e).slice(0, 160); }
    const g = r ? grade(t, r, profile) : { ok: false, problems: ['error'] };
    out.push({ text: t.text, expect: t.expect, extra: !!t.extra, line: r ? r.line : null, ok: g.ok, problems: g.problems, ms: Date.now() - t0, path: r ? r.path : null, model: streamFor ? (r && r.timings && r.timings.replyOutcome) || null : 'off', lookup_ms: r && r.timings ? r.timings.kbLookupMs ?? null : null, kb_kind: r && r.timings ? r.timings.kbKind || null : null, error: err });
  }
  return out;
}

module.exports = { runTextTests, buildScript, grade };
