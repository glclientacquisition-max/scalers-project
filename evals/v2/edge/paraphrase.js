#!/usr/bin/env node
'use strict';
// Optional: add Gemini paraphrases of the generator's synthetic opening lines (no call data ever
// leaves the box). Cached in paraphrases.json so sweeps stay deterministic and offline.
//   GEMINI_API_KEY=... node evals/v2/edge/paraphrase.js [--batch 25] [--max-calls 10]
const fs = require('fs');
const path = require('path');
const { generate } = require('./gen');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const KEY = process.env.GEMINI_API_KEY; if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(2); }
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const F = path.join(__dirname, 'paraphrases.json');
const cache = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : {};
const lines = [...new Set(generate({}).filter((c) => !c.noPerturb).map((c) => c.turns[0][0]))].filter((l) => !cache[l]);
const BATCH = Number(args.batch || 25), MAX = Number(args['max-calls'] || 10);
const PROMPT = `You write realistic Kenyan phone-caller utterances for testing a cleaning-company booking assistant.
For each input line, give 2 paraphrases a real caller in Nairobi might say, in the SAME language mix (English, Swahili, or Sheng/code-switched). Keep every fact identical: service, day word (e.g. kesho/tomorrow/Ijumaa/Friday/next Friday), time and its period (asubuhi/mchana/jioni/usiku, am/pm), place, and any self-correction order. Do not add new facts. Keep each under 25 words.
Return JSON only: {"<input line>": ["p1", "p2"], ...}`;
(async () => {
  let calls = 0;
  for (let i = 0; i < lines.length && calls < MAX; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    const body = { contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nInput lines:\n${JSON.stringify(chunk, null, 1)}` }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } };
    calls++;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    if (!r.ok) { console.error('gemini http', r.status); continue; }
    const j = await r.json();
    const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    try { const o = JSON.parse(txt); for (const l of chunk) if (Array.isArray(o[l])) cache[l] = o[l].filter((x) => typeof x === 'string' && x.length < 200).slice(0, 2); } catch { console.error('bad json in batch', i); }
  }
  fs.writeFileSync(F, JSON.stringify(cache, null, 1));
  console.log(`gemini calls=${calls} cached lines=${Object.keys(cache).length} pending=${lines.length - Object.keys(cache).length}`);
})();
