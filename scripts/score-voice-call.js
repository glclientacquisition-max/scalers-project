#!/usr/bin/env node
// Score one stored call. Staging traces live in voice_turn_traces.
// A JSONL sink works with --file for a laptop that does not have Supabase.

const { readStoredTurns } = require('../src/speech/voiceTrace');
const { scoreTurns, diagnoseCall, formatSummary } = require('../src/speech/voiceScore');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  const callId = process.argv.slice(2).find((item) => item && !item.startsWith('--'));
  if (!callId) {
    console.error('Usage: node scripts/score-voice-call.js CALL_ID [--file path.jsonl]');
    process.exit(1);
  }
  const file = arg('--file');
  const turns = await readStoredTurns(callId, file ? { file } : {});
  if (!turns.length) {
    console.error(`No turn traces for ${callId}`);
    process.exit(1);
  }
  const body = scoreTurns(turns);
  const scorecard = {
    calls: [
      {
        callId,
        score: body.score,
        checks: body.checks,
        nameAsks: body.nameAsks,
        turns: body.turns,
        historical: [],
      },
    ],
  };
  console.log(formatSummary(scorecard));
  const diagnosis = diagnoseCall(body);
  console.log(diagnosis);
  console.log(JSON.stringify({ callId, score: body.score, checks: body.checks, diagnosis, nameAsks: body.nameAsks }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
