#!/usr/bin/env node
'use strict';
// Markdown tables from results/*.json (used for the Phase 0 report).
const fs = require('fs'); const path = require('path');
const R = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'results', f)));
const builds = [['main-7d870a75-prod.json', 'main 7d870a75 (prod flags)'], ['curated-staging-6b7b87a-staging.json', 'curated staging main+#674 (staging flags)'], ['live-staging-7dbf40e-staging.json', 'live staging 7dbf40e (staging flags)'], ['live-staging-7dbf40e-staging+ci.json', 'live staging 7dbf40e + CALLER_INFO_P1']];
const rows = [];
for (const sfx of ['', '-clean']) for (const [f, name] of builds) {
  const file = f.replace(/-(prod|staging)(\+ci)?\.json$/, `${sfx}-$1$2.json`);
  if (!fs.existsSync(path.join(__dirname, 'results', file))) continue;
  const s = R(file).summary;
  rows.push(`| ${name} | ${sfx ? 'clean (0%)' : 'noisy (30%)'} | ${(s.passK * 100).toFixed(0)}% | ${(s.pass1 * 100).toFixed(0)}% | ${(s.endStatePassK * 100).toFixed(0)}% | ${(s.bookingCorrectnessPassK * 100).toFixed(0)}% | ${(s.readbackCompliance * 100).toFixed(0)}% | ${(s.falseClaimTurnRate * 100).toFixed(1)}% | ${s.brainMsP50} / ${s.brainMsP95} | ${s.brainMsP95ToolTurns} |`);
}
console.log('| Build | Model | pass^4 (all rules) | pass^1 | end-state pass^4 | booking correctness pass^4 | read-back+yes compliance | false-claim turn rate | Brain ms p50 / p95 | Brain ms p95 tool turns |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log('\n| Scenario | area | ' + builds.map((b) => b[1].split(' (')[0]).join(' | ') + ' |');
console.log('|---|---|' + builds.map(() => '---').join('|') + '|');
const all = builds.map(([f]) => R(f));
for (const s of all[0].scenarios) {
  const cells = all.map((r) => { const x = r.scenarios.find((y) => y.id === s.id); return `${x.passK ? '✅' : '❌'} ${Math.round(x.pass1 * 4)}/4 · state ${x.endStatePassK ? '✅' : '❌'}`; });
  console.log(`| ${s.id} | ${s.area} | ${cells.join(' | ')} |`);
}
for (const f of ['replay-main-7d870a75-prod.json', 'replay-curated-staging-6b7b87a-staging.json', 'replay-live-staging-7dbf40e-staging.json']) {
  if (!fs.existsSync(path.join(__dirname, 'results', f))) continue;
  const r = R(f); console.log(`\n**${f}**: ${JSON.stringify(r.summary)}`);
  for (const c of r.cases.filter((c) => c.labelled)) console.log(`- ${c.id} ${c.passK ? 'PASS' : 'FAIL'}: ${[...new Set(c.runs.flatMap((x) => x.fails.map((y) => y.slice(0, 120))))].join('; ')}`);
}
