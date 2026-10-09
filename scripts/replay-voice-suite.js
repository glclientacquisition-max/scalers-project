#!/usr/bin/env node
// Replay the seeded calls through the current mouth and fail if scores fall.
// Recorded mode is the CI gate. --live asks Gemini. --update-baseline rewrites
// the committed scorecard after an intentional gain.
//
// --mouth structured replays the Phase 2 mouth (VOICE_STRUCTURED_OUTPUT=on).
// Gate: every call scores at least its legacy baseline, and deletedAnswer,
// languageMismatch, gluedPiece and letterlessPiece are 0. Model turns use
// tests/fixtures/voice-calls-structured/<callId>.json when present (a real
// `--live --record` capture or a hand-checked mock), else an inline mock
// built from the recorded legacy Gemini text. --live --record (needs
// GEMINI_API_KEY; never run in CI) asks Gemini under responseSchema and writes
// those sidecars with the raw chunk texts.

const fs = require('fs');
const path = require('path');
const { replayCall } = require('../src/speech/replayVoice');
const { scoreFixtureReplay, compareToBaseline, formatSummary } = require('../src/speech/voiceScore');


const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-calls');
const STRUCTURED_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-calls-structured');
const BASELINE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-eval-baseline.json');
const STRUCTURED_ZERO = ['deletedAnswer', 'languageMismatch'];
const STRUCTURED_MOUTH_ZERO = ['gluedPiece', 'letterlessPiece'];

function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')));
}

function loadStructuredRecording(callId) {
  const file = path.join(STRUCTURED_DIR, `${callId}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function baselineShape(calls) {
  const out = {};
  for (const call of calls) {
    out[call.callId] = {
      score: call.score,
      checks: call.checks,
      mouth: call.mouth,
      nameAsks: call.nameAsks,
    };
  }
  return {
    schema: 'scalers.voice.eval-baseline',
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    calls: out,
  };
}

/**
 * Structured gate, on the turns both mouths scored (a mock turn the lock
 * cannot judge is needs_recording and scored by neither):
 * - the structured mean is at least the legacy mean;
 * - turns the structured engine spoke have deletedAnswer 0 and languageMismatch 0
 *   (a barged turn is held to legacy for deletedAnswer: the cut reply has no tts row)
 *   (canned / early-return turns are Phase 3 and only held to "not worse");
 * - no turn sends a glued or letterless TTS piece.
 */
const shared = [];

function compareStructured(pairs) {
  const failures = [];
  for (const { structured, legacy, replay } of pairs) {
    const id = structured.callId;
    let sSum = 0;
    let lSum = 0;
    let n = 0;
    structured.turns.forEach((turn, i) => {
      const other = legacy.turns[i];
      if (turn.score == null || other?.score == null) return;
      sSum += turn.score;
      lSum += other.score;
      n += 1;
    });
    shared.push(`${id} shared turns ${n}: structured ${n ? (sSum / n).toFixed(1) : '-'} vs legacy ${n ? (lSum / n).toFixed(1) : '-'}`);
    if (n && sSum / n + 1e-9 < lSum / n) {
      failures.push(`${id} structured ${(sSum / n).toFixed(1)} < legacy ${(lSum / n).toFixed(1)} on ${n} shared turns`);
    }
    structured.turns.forEach((turn, i) => {
      const spokeStructured = (replay.turns[i]?.stages || []).some((row) => row.stage === 'structured');
      if (spokeStructured && turn.score != null) {
        // A barge-in cut the playback: the reply never reached a tts row, so the
        // scorer reads it as deleted on both mouths. Hold that turn to "not worse
        // than legacy" for deletedAnswer instead of zero (HD_72ab69cbab2b t2).
        const barged = (replay.turns[i]?.stages || []).some((row) => row.stage === 'outcome' && row.value === 'barge_in');
        for (const key of STRUCTURED_ZERO) {
          const value = Number(turn.checks?.[key] || 0);
          if (barged && key === 'deletedAnswer' && value <= Number(legacy.turns[i]?.checks?.[key] || 0)) continue;
          if (value > 0) failures.push(`${id} #${i + 1} ${key}=${turn.checks[key]}`);
        }
      }
      for (const key of STRUCTURED_MOUTH_ZERO) {
        if (Number(turn.mouth?.[key] || 0) > 0) failures.push(`${id} #${i + 1} mouth.${key}=${turn.mouth[key]}`);
      }
    });
  }
  return failures;
}

function needsRecordingCount(replay) {
  return replay.turns.filter((turn) => (turn.stages || []).some((row) => row.stage === 'outcome' && row.value === 'needs_recording')).length;
}

function liveStructured(fixture, record) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for --live --mouth structured');
  const { GoogleGenAI } = require('@google/genai');
  const { buildSystemPrompt } = require('../src/prompts');
  const { languageDirective } = require('../src/conversation/language');
  const { geminiPrimaryModel } = require('../src/conversation/geminiVoice');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return {
    model: geminiPrimaryModel(),
    generateContentStream: (request) => ai.models.generateContentStream(request),
    systemPrompt: (language) =>
      [buildSystemPrompt({ businessName: fixture.businessName || 'the business' }), languageDirective(language)]
        .filter(Boolean)
        .join('\n\n'),
    record,
  };
}

async function main() {
  const update = process.argv.includes('--update-baseline') || process.argv.includes('--write-baseline');
  const live = process.argv.includes('--live');
  const recordLive = process.argv.includes('--record');
  const mouthArg = process.argv.find((arg) => arg.startsWith('--mouth'));
  const mouthIndex = process.argv.indexOf('--mouth');
  const mouth =
    (mouthArg && mouthArg.includes('=') ? mouthArg.split('=')[1] : null) ||
    (mouthIndex >= 0 ? process.argv[mouthIndex + 1] : null) ||
    'legacy';
  const structured = mouth === 'structured';
  const fixtures = loadFixtures();
  const calls = [];
  const pairs = [];
  const pending = [];
  for (const fixture of fixtures) {
    let replay;
    if (structured) {
      const recorded = {};
      const opts = {
        mode: 'recorded',
        mouth: 'structured',
        structuredRecording: live ? null : loadStructuredRecording(fixture.callId),
      };
      if (live) {
        opts.structuredLive = liveStructured(fixture, (turnIndex, row) => {
          recorded[String(turnIndex)] = row;
        });
      }
      replay = await replayCall(fixture, opts);
      if (live && recordLive) {
        fs.mkdirSync(STRUCTURED_DIR, { recursive: true });
        const out = {
          schema: 'scalers.voice.structured-recording',
          schemaVersion: 1,
          callId: fixture.callId,
          mock: false,
          recordedAt: new Date().toISOString(),
          source: 'replay-voice-suite --live --record --mouth structured',
          turns: recorded,
        };
        fs.writeFileSync(path.join(STRUCTURED_DIR, `${fixture.callId}.json`), `${JSON.stringify(out, null, 2)}\n`);
      }
    } else {
      replay = await replayCall(fixture, { mode: live ? 'live' : 'recorded' });
    }
    const scored = scoreFixtureReplay(replay, fixture);
    calls.push(scored);
    if (structured) {
      const legacyReplay = await replayCall(fixture, { mode: 'recorded' });
      pairs.push({ structured: scored, legacy: scoreFixtureReplay(legacyReplay, fixture), replay });
      const count = needsRecordingCount(replay);
      if (count) pending.push(`${fixture.callId}: ${count} turn(s) need a live structured recording`);
    }
  }
  const scorecard = { calls, failures: [] };
  if (update && !live && !structured) {
    const next = baselineShape(calls);
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
  if (structured) scorecard.failures = compareStructured(pairs);
  else if (!live) scorecard.failures = compareToBaseline(scorecard, baseline);
  if (structured) console.log('mouth: structured (VOICE_STRUCTURED_OUTPUT=on)');
  console.log(formatSummary(scorecard));
  if (structured) {
    for (const { structured: s1, legacy: l1 } of pairs) {
      console.log(`  ${s1.callId} whole call: structured ${s1.score} | legacy ${l1.score}`);
    }
    for (const line of shared) console.log(`  ${line}`);
    for (const line of pending) console.log(`  pending: ${line}`);
  }
  if (scorecard.failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
