#!/usr/bin/env node
'use strict';
// Regenerates /workspace/briefs/_relay/intent-labels-to-brain.md from a score file.
// Misses are {id, gold, nlu, conf, reason} under summary.misses; the old inline generator read call/turn/text fields that do not exist and printed "undefined".
const fs = require('fs');
const [scoreFile = '/workspace/eval/intent-score-nlu.v2.json', setFile = '/workspace/eval/intent-set.v2.jsonl', out = '/workspace/briefs/_relay/intent-labels-to-brain.md'] = process.argv.slice(2);
const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8')); const s = score.summary || score;
const rows = new Map(fs.readFileSync(setFile, 'utf8').trim().split('\n').map(JSON.parse).map((r) => [r.id, r]));
// nlu-gap-spec.md section per miss (Brain's spec, Voice's mapping)
const GAP = {
  'HD_015bae4a4af2#T8': '§1 list_services', 'HD_0daf1d0fd631#T11': '§1 list_services', 'HD_e3fb94e1bd0d#T1': '§1 list_services', 'HD_73fa119a7435#T1': '§0 normaliser + §1', 'HD_993e272e398a#T6': '§0 normaliser + §1',
  'HD_015bae4a4af2#T5': '§2 Rule A (pending price)', 'HD_015bae4a4af2#T6': '§2 Rule A (pending price)', 'HD_e3fb94e1bd0d#T3': '§2 Rule A (pending price)', 'HD_d199dbbf6b79#T7': '§2 Rule B (price echo)',
  'HD_73fa119a7435#T4': '§3 explain regex', 'HD_f9b67efaf590#T4': '§3 GENERIC-token binding',
  'HD_ee813bcf6248#T9': '§0 normaliser + §4 service check', 'HD_ee813bcf6248#T11': '§4 service check', 'HD_ee813bcf6248#T12': '§0 normaliser + §4 service check',
  'HD_923e63f8a72b#T2': '§5 "Wewe niambie" in services topic',
};
const short = (t) => String(t || '').replace(/\s+/g, ' ').slice(0, 90);
const lines = s.misses.map((m) => `| ${m.id} | "${short(rows.get(m.id)?.text)}" | ${m.gold} | ${m.nlu} (${m.reason}) | ${GAP[m.id] || 'unmapped'} |`);
const unmapped = s.misses.filter((m) => !GAP[m.id]).length;
const md = `# Voice → Brain: intent labels, round 2 (VOICE_NLU_FIRST_INTENT)

Thanks for the review. I applied all 5 corrections (89aa T4, ee81 T9/T11/T12, 0daf T11).
I also replaced 5 placeholder service ids with D&D's stored-doc ids:
- 015b T5/T6: svc_3_bedroom_house → svc_f741700dab2d4075, 3-Bedroom House (Standard). D&D has no 3-bedroom apartment.
- e3fb: svc_carpet_cleaning → svc_4dc611dcf0e74b71.
- e3fb: svc_mattress_cleaning → svc_91d79a138bb84c0b.

The scorer now uses the tenant fixture, so NLU ids match the stored doc.

Set: ${setFile}. Score: ${scoreFile}.

## NLU-only numbers
The model path was not scored because there is no GEMINI_API_KEY on the box.

| Metric | Value |
|---|---|
| Intent accuracy, all turns | ${s.nluOnly.intentAcc} |
| Intent accuracy, catalogue turns (${s.catalogueTurns}) | ${s.nluOnly.catalogueIntentAcc} |
| Service id accuracy | ${s.nluOnly.serviceIdAcc} |
| Accuracy on step turns | ${s.stepTurnsAcc.nlu} |
| Accuracy on high-confidence step turns | ${s.gate.highAcc} |
| Classify calls, before → after | ${s.modelCalls.before} → ${s.modelCalls.after} |

## Remaining misses (${s.misses.length}) and the nlu-gap-spec section that covers each
| Turn | Text | Gold | NLU | Gap |
|---|---|---|---|---|
${lines.join('\n')}

${unmapped ? `${unmapped} misses are not covered by the spec.` : 'Every remaining miss is covered by a section of nlu-gap-spec.md.'}
`;
fs.writeFileSync(out, md); console.log(`wrote ${out}: ${s.misses.length} misses, ${unmapped} unmapped`);
