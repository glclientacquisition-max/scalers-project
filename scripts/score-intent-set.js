#!/usr/bin/env node
// Score NLU-only vs NLU+model (VOICE_NLU_FIRST_INTENT) on the intent eval set.
//   node scripts/score-intent-set.js [/workspace/eval/intent-set.jsonl] [--json out.json]
// Model path needs GEMINI_API_KEY (never printed). Without it: NLU-only scored, model path not run.
const fs = require('fs'); const path = require('path');
const SC = require('../src/knowledge/spokenCatalogue');
const G = require('../src/conversation/v2/intentGate');
const C = require('../src/conversation/v2/catalogueStep');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || '/workspace/eval/intent-set.jsonl';
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const root = path.join(__dirname, '..');
function profileFor(r) {
  const j = JSON.parse(fs.readFileSync(path.join(root, r.source), 'utf8'));
  if (j.tenant) { try { return require(path.join(root, 'evals/v2/fixtures/tenants', `${j.tenant}.json`)); } catch { return {}; } }
  if (Array.isArray(j.turns) && j.turns[0]?.callId && j.catalogue) return { servicesCatalog: j.catalogue.map((name) => ({ name })) };
  return j.profile || (j.servicesCatalog ? j : { servicesCatalog: (j.catalogue || []).map((n) => (typeof n === 'string' ? { name: n } : n)) });
}
const key = String(process.env.GEMINI_API_KEY || '').trim();
const model = key ? require('../src/conversation/v2/transport').createGeminiSend({ apiKey: key, model: process.env.VOICE_V2_CATALOGUE_MODEL_NAME || 'gemini-3.5-flash-lite', timeoutMs: 700 }) : null;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
(async () => {
  const res = []; let topicByCall = {};
  const docs = {};
  for (const r of rows) {
    const profile = profileFor(r);
    const doc = (docs[r.source] ||= SC.compileSync(profile));
    const t0 = process.hrtime.bigint();
    const nlu = G.nluIntent(r.text, { profile, doc, topic: topicByCall[r.callId] || null });
    const nluMs = Number(process.hrtime.bigint() - t0) / 1e6;
    topicByCall[r.callId] = nlu.intent === 'list_services' ? 'services' : nlu.intent === 'other' ? topicByCall[r.callId] && null : topicByCall[r.callId];
    let hybrid = { intent: nlu.intent, service_id: nlu.service_id, source: nlu.confidence === 'high' ? 'skip' : 'nlu', ms: 0 };
    if (model && nlu.confidence !== 'high') {
      const mc = await C.modelCommand({ model, text: r.text, sc: doc, lang: r.lang === 'sw' ? 'sw' : 'en', timeoutMs: 700 });
      hybrid = mc.command ? { intent: mc.command.intent, service_id: mc.command.service_id || null, source: 'model', ms: mc.ms } : { ...hybrid, source: 'nlu', ms: mc.ms, error: mc.error };
    }
    const stepEntered = C.looksCatalogue(r.text, profile, {}) || nlu.reason === 'empty_in_topic' || nlu.reason === 'services_followup';
    if (!stepEntered && nlu.intent === 'other') nlu.confidence = 'n/a (step not entered)';
    res.push({ id: r.id, gold: r.proposed, nlu, nluMs, hybrid, stepEntered });
  }
  const ok = (p, g) => p.intent === g.intent;
  const okSvc = (p, g) => !g.service_id || p.service_id === g.service_id;
  const n = res.length;
  const cat = res.filter((x) => x.gold.intent !== 'other');
  const summary = {
    turns: n, catalogueTurns: cat.length, modelAvailable: Boolean(model),
    nluOnly: { intentAcc: pct(res.filter((x) => ok(x.nlu, x.gold)).length, n), catalogueIntentAcc: pct(cat.filter((x) => ok(x.nlu, x.gold)).length, cat.length), serviceIdAcc: pct(res.filter((x) => x.gold.service_id && okSvc(x.nlu, x.gold)).length, res.filter((x) => x.gold.service_id).length), p50ms: Number(q(res.map((x) => x.nluMs), 0.5)?.toFixed?.(2) ?? 0), p95ms: q(res.map((x) => x.nluMs), 0.95) },
    gate: { stepTurns: res.filter((x) => x.stepEntered).length, high: res.filter((x) => x.stepEntered && x.nlu.confidence === 'high').length, low: res.filter((x) => x.stepEntered && x.nlu.confidence === 'low').length, highAcc: pct(res.filter((x) => x.stepEntered && x.nlu.confidence === 'high' && ok(x.nlu, x.gold) && okSvc(x.nlu, x.gold)).length, res.filter((x) => x.stepEntered && x.nlu.confidence === 'high').length), lowReasons: res.filter((x) => x.stepEntered && x.nlu.confidence === 'low').reduce((m, x) => ((m[x.nlu.reason] = (m[x.nlu.reason] || 0) + 1), m), {}) },
    modelCalls: { before: res.filter((x) => x.stepEntered).length, after: res.filter((x) => x.stepEntered && x.nlu.confidence !== 'high').length, note: 'before = every turn entering the catalogue step paid the classify (<=700 ms; live sample timed out at 702 ms); after = VOICE_NLU_FIRST_INTENT' },
    stepTurnsAcc: { nlu: pct(res.filter((x) => x.stepEntered && ok(x.nlu, x.gold)).length, res.filter((x) => x.stepEntered).length) },
    hybrid: model ? { intentAcc: pct(res.filter((x) => ok(x.hybrid, x.gold)).length, n), catalogueIntentAcc: pct(cat.filter((x) => ok(x.hybrid, x.gold)).length, cat.length), modelCalls: res.filter((x) => x.hybrid.ms).length, modelUsed: res.filter((x) => x.hybrid.source === 'model').length, addedMsP50: q(res.filter((x) => x.hybrid.ms).map((x) => x.hybrid.ms), 0.5), addedMsP95: q(res.filter((x) => x.hybrid.ms).map((x) => x.hybrid.ms), 0.95) } : 'not run: GEMINI_API_KEY not set',
    misses: res.filter((x) => !ok(x.nlu, x.gold) || !okSvc(x.nlu, x.gold)).map((x) => ({ id: x.id, gold: x.gold.intent + (x.gold.service_id ? `:${x.gold.service_id}` : ''), nlu: x.nlu.intent + (x.nlu.service_id ? `:${x.nlu.service_id}` : ''), conf: x.nlu.confidence, reason: x.nlu.reason })),
  };
  console.log(JSON.stringify(summary, null, 1));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ summary, rows: res }, null, 1));
})();
