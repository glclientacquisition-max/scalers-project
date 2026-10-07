#!/usr/bin/env node
// Replay the seeded calls through the current mouth and fail if scores fall.
// Recorded mode is the CI gate. --live asks Gemini. --update-baseline rewrites
// the committed scorecard after an intentional gain.

process.env.VOICE_STRUCTURED_REPLY = 'on';

const fs = require('fs');
const path = require('path');
const { replayCall } = require('../src/speech/replayVoice');
const {
  scoreFixtureReplay,
  compareToBaseline,
  formatSummary,
  firstPcmRegression,
  FIRST_PCM_P50_TARGET_MS,
} = require('../src/speech/voiceScore');

const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-calls');
const BASELINE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-eval-baseline.json');

function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')));
}

function baselineShape(calls, previous = {}) {
  const out = {};
  for (const call of calls) {
    out[call.callId] = {
      score: call.score,
      checks: call.checks,
      nameAsks: call.nameAsks,
    };
  }
  return {
    schema: 'scalers.voice.eval-baseline',
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    firstPcmP50: previous.firstPcmP50 ?? null,
    firstPcmP50TargetMs: previous.firstPcmP50TargetMs ?? 1200,
    calls: out,
  };
}

async function main() {
  const update = process.argv.includes('--update-baseline') || process.argv.includes('--write-baseline');
  const live = process.argv.includes('--live');
  const fixtures = loadFixtures();
  const calls = [];
  const pcmSamples = [];
  for (const fixture of fixtures) {
    const replay = await replayCall(fixture, { mode: live ? 'live' : 'recorded' });
    for (const turn of replay.turns || []) {
      const latency = (turn.stages || []).find((row) => row.stage === 'latency');
      const pcm = latency?.callerStopToFirstTtsPcmMs;
      if (pcm != null) pcmSamples.push(pcm);
    }
    calls.push(scoreFixtureReplay(replay, fixture));
  }
  const scorecard = { calls, failures: [], pcmSamples };
  if (update && !live) {
    const previous = fs.existsSync(BASELINE_PATH)
      ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
      : {};
    const next = baselineShape(calls, previous);
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(formatSummary(scorecard));
    console.log(`Wrote ${BASELINE_PATH}`);
    return;
  }
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('Missing baseline. Run with --update-baseline once.');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (!live) scorecard.failures = compareToBaseline(scorecard, baseline);
  const pcm = firstPcmRegression(pcmSamples, baseline.firstPcmP50);
  if (pcm.p50 != null) {
    console.log(
      `first_pcm p50=${Math.round(pcm.p50)}ms target<=${FIRST_PCM_P50_TARGET_MS}ms` +
        (pcm.baselineP50 == null ? '' : ` baseline=${pcm.baselineP50}ms delta=${Math.round(pcm.delta)}ms`)
    );
  }
  if (!live && pcm.regression) {
    scorecard.failures.push(
      `first_pcm p50 ${Math.round(pcm.p50)}ms regresses more than 200ms from ${pcm.baselineP50}ms`
    );
  }
  console.log(formatSummary(scorecard));
  if (scorecard.failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
