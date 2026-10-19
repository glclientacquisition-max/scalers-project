'use strict';
// Release gate. Fact-refs stays on its own flags (lookups forced off).
// Lookup replays run with VOICE_LOOKUPS on. False deletions may not rise
// above evals/replay/baseline.json.

const fs = require('fs');
const path = require('path');
const { runEval } = require('./eval-fact-refs');
const { runFixtures } = require('../evals/replay/run');

const BASELINE_PATH = path.join(__dirname, '..', 'evals', 'replay', 'baseline.json');

function withLookupsOff(fn) {
  const prev = process.env.VOICE_LOOKUPS;
  const tool = process.env.VOICE_LOOKUP_TOOL;
  delete process.env.VOICE_LOOKUPS;
  delete process.env.VOICE_LOOKUP_TOOL;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.VOICE_LOOKUPS;
    else process.env.VOICE_LOOKUPS = prev;
    if (tool == null) delete process.env.VOICE_LOOKUP_TOOL;
    else process.env.VOICE_LOOKUP_TOOL = tool;
  }
}

function measure() {
  const factRefs = withLookupsOff(() => runEval());
  const replay = runFixtures();
  return {
    factRefs: {
      before: factRefs.before.totals,
      after: factRefs.after.totals,
    },
    replay: {
      totals: replay.totals,
      p95: replay.p95,
      median: replay.median,
      cap: replay.cap,
      failures: replay.failures,
    },
  };
}

function check(measured, baseline) {
  const problems = [];
  const after = measured.factRefs.after;
  const replay = measured.replay.totals;
  if (after.falseNotOnFile > 0) problems.push(`fact-refs false not-on-file ${after.falseNotOnFile}`);
  if (after.falseDeletions > baseline.factRefs.after.falseDeletions) {
    problems.push(
      `fact-refs false deletions ${after.falseDeletions} above baseline ${baseline.factRefs.after.falseDeletions}`
    );
  }
  if (replay.inventedFacts > 0) problems.push(`replay invented facts ${replay.inventedFacts}`);
  if (replay.falseNotOnFile > 0) problems.push(`replay false not-on-file ${replay.falseNotOnFile}`);
  if (replay.callbacksOnly > 0) problems.push(`replay callbacks-only ${replay.callbacksOnly}`);
  if (replay.languageMismatch > 0) problems.push(`replay language mismatch ${replay.languageMismatch}`);
  if (replay.falseDeletions > baseline.replay.falseDeletions) {
    problems.push(`replay false deletions ${replay.falseDeletions} above baseline ${baseline.replay.falseDeletions}`);
  }
  if (measured.replay.median > 40 || measured.replay.p95 > measured.replay.cap) {
    problems.push(
      `lookup brain median ${Number(measured.replay.median).toFixed(1)}ms p95 ${Number(measured.replay.p95).toFixed(1)}ms above cap ${Number(measured.replay.cap).toFixed(1)}ms`
    );
  }
  if (measured.replay.failures.length) problems.push(...measured.replay.failures);
  return problems;
}

function main() {
  const measured = measure();
  if (process.argv.includes('--write-baseline')) {
    const baseline = {
      factRefs: { after: { falseDeletions: measured.factRefs.after.falseDeletions, falseNotOnFile: measured.factRefs.after.falseNotOnFile } },
      replay: { falseDeletions: 0 },
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log('wrote', BASELINE_PATH);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const problems = check(measured, baseline);
  console.log('fact-refs before', measured.factRefs.before);
  console.log('fact-refs after ', measured.factRefs.after);
  console.log('replay', measured.replay.totals, `p95=${measured.replay.p95.toFixed(2)}ms`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { measure, check };
