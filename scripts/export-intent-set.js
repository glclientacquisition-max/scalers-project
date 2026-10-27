#!/usr/bin/env node
// Export every caller turn from the HD fixtures + v2 replay fixtures as an intent
// eval set (JSONL). Labels are PROPOSED (heuristic, independent of nlu.js) until
// Brain confirms them: /workspace/briefs/_relay/intent-labels-to-brain.md.
//   node scripts/export-intent-set.js [out.jsonl]
const fs = require('fs'); const path = require('path');
const SC = require('../src/knowledge/spokenCatalogue');
const out = process.argv[2] || '/workspace/eval/intent-set.jsonl';
const root = path.join(__dirname, '..');
const fx = path.join(root, 'tests', 'fixtures');
const files = ['voice-calls', 'no-answer-delete', 'hedge-gap'].flatMap((d) => fs.readdirSync(path.join(fx, d)).filter((f) => f.endsWith('.json')).map((f) => path.join(fx, d, f)));
// A call fixture that names a tenant with a full fixture uses that tenant's catalogue, so ids are the stored-doc ids, not slugs of the call's name list.
function tenantFixtureById(id) {
  if (!id) return null; const dir = path.join(__dirname, '..', 'evals/v2/fixtures/tenants');
  for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (t.tenantId === id) return t; }
  return null;
}
function callsOf(j, file) {
  if (Array.isArray(j.turns) && j.turns[0]?.callId && j.catalogue) {
    const by = {}; for (const t of j.turns) (by[t.callId] ||= []).push(t);
    return Object.entries(by).map(([callId, turns]) => ({ callId, profile: { servicesCatalog: j.catalogue.map((name) => ({ name })) }, turns, file }));
  }
  const profile = tenantFixtureById(j.tenantId || j.profile?.tenantId) || j.profile || (j.servicesCatalog ? j : { servicesCatalog: (j.catalogue || []).map((name) => (typeof name === 'string' ? { name } : name)) });
  const turns = j.turns || (j.t7 ? [j.t7] : []);
  return [{ callId: j.callId || j.sid || path.basename(file, '.json'), profile, turns, lang: j.lang, file }];
}
const calls = files.flatMap((f) => { try { return callsOf(JSON.parse(fs.readFileSync(f, 'utf8')), f); } catch { return []; } });
const replayDir = path.join(root, 'evals', 'v2', 'fixtures', 'replay');
for (const f of fs.readdirSync(replayDir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(replayDir, f), 'utf8'));
  let profile = {}; try { profile = require(path.join(root, 'evals', 'v2', 'fixtures', 'tenants', `${j.tenant}.json`)); } catch { /* none */ }
  calls.push({ callId: j.sid || j.id, profile, turns: (j.turns || []).map((t) => ({ caller: t.caller })), lang: j.lang, file: path.join(replayDir, f) });
}

// Proposed label: deliberately simple, independent of nlu.js.
const LIST = /\b(services?|huduma|mnafanya nini|mna-?offer|mnaoffer|mnapea|mnatoa|what do you (do|offer)|which services|gani mn|mnawashangaa|do you do|offer)\b/i;
const EXPLAIN = /\b(niambie|nieleze|eleza|kuhusu|tell me (more )?about|explain|what('?s| is) (included|in)|inahusisha|details?|means?)\b/i;
const PRICE = /\b(bei|how much|price|cost|pesa ngapi|ni ngapi|charge|rates?)\b/i;
function propose(text, doc) {
  const t = String(text || '');
  const e = doc ? SC.findEntry(t, doc) : null;
  if (PRICE.test(t)) return { intent: 'price_service', service_id: e?.id || null };
  if (EXPLAIN.test(t) && e) return { intent: 'explain_service', service_id: e.id };
  if (LIST.test(t) && !/\b(book|appointment|niwekee|kubook)\b/i.test(t)) return { intent: 'list_services', service_id: null };
  if (EXPLAIN.test(t)) return { intent: 'explain_service', service_id: null };
  return { intent: 'other', service_id: null };
}
// Voice review of the heuristic pass (context-dependent turns). service: a phrase resolved with findEntry.
const REVIEW = {
  'HD_923e63f8a72b#T2': { intent: 'list_services', note: '"you tell me" right after asking what they do' },
  'HD_015bae4a4af2#T8': { intent: 'list_services' },
  'HD_015bae4a4af2#T5': { intent: 'price_service', service: '3-bedroom apartment', note: 'answers "for which?" after how much' },
  'HD_015bae4a4af2#T6': { intent: 'price_service', service: '3-bedroom apartment' },
  'HD_89aa48bf657f#T2': { intent: 'list_services', note: 'ASR "usasi" = usafi' },
  'HD_b401138c8ffd#T5': { intent: 'list_services', note: 'follow-up to a services answer' },
  'HD_e3fb94e1bd0d#T3': { intent: 'price_service', service: 'carpet cleaning', note: 'answers the price clarify' },
  'HD_d199dbbf6b79#T7': { intent: 'price_service', service: 'window cleaning', note: 'checks the window price just given' },
  'HD_ee813bcf6248#T9': { intent: 'other', note: '"do you clean windows?" offered-check; no class in the schema' },
  'HD_ee813bcf6248#T11': { intent: 'other', note: 'offered-check (carpet)' },
  'HD_ee813bcf6248#T12': { intent: 'other', note: 'offered-check (carpet)' },
};
const rows = []; const seen = new Set();
for (const c of calls) {
  if (!c.profile?.servicesCatalog?.length) continue;
  const doc = SC.compileSync(c.profile);
  for (const [i, t] of (c.turns || []).entries()) {
    const text = String(t.caller || t.text || '').trim();
    if (!text) continue;
    const key = `${c.callId}|${i}|${text}`; if (seen.has(key)) continue; seen.add(key);
    const id = `${c.callId}#T${t.turn || i + 1}`;
    let proposed = propose(text, doc); let labelSource = 'heuristic';
    if (REVIEW[id]) { const rv = REVIEW[id]; const e = rv.service ? doc.entries.find((x) => x.raw.name.toLowerCase().includes(rv.service.split(' ')[0])) || SC.findEntry(rv.service, doc) : null; proposed = { intent: rv.intent, service_id: e?.id || (rv.intent.endsWith('_service') && rv.intent !== 'list_services' ? proposed.service_id : null), ...(rv.note ? { note: rv.note } : {}) }; labelSource = 'voice_review'; }
    rows.push({ id, callId: c.callId, turn: t.turn || i + 1, lang: c.lang || t.lang || null, text, prev: i ? String(c.turns[i - 1].caller || '') : null, source: path.relative(root, c.file), proposed, labelSource, labelStatus: 'proposed' });
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${rows.length} turns from ${calls.length} calls -> ${out}`);
const by = {}; for (const r of rows) by[r.proposed.intent] = (by[r.proposed.intent] || 0) + 1; console.log(by);
