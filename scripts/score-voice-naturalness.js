#!/usr/bin/env node
// Score a live DID transcript JSON for Voice-owned robotic artifacts.
//
// Usage:
//   node scripts/score-voice-naturalness.js --file tests/fixtures/voice-naturalness-sample.json
//   node scripts/score-voice-naturalness.js --file turns.json --logs spoken.log
//
// JSON shape: { callSid?, turns: [{ speaker, text }] }
// Does not retune Soniox. Measure first. See docs/agents/VOICE_NATURALNESS.md.

const fs = require('fs');
const path = require('path');
const { scoreCall } = require('../src/speech/naturalnessScore');

function parseArgs(argv) {
  const opts = { file: null, logs: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' && argv[i + 1]) opts.file = path.resolve(argv[++i]);
    else if (arg === '--logs' && argv[i + 1]) opts.logs = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/score-voice-naturalness.js --file turns.json [--logs railway.log]

JSON: { "callSid": "HD_…", "turns": [{ "speaker": "agent"|"caller", "text": "…" }] }
Exit 0 if no Voice-owned fails. Brain notes do not fail the process.
`);
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.file) {
    console.error('Need --file <turns.json>. See docs/agents/VOICE_NATURALNESS.md');
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  const spokenLogs = opts.logs ? fs.readFileSync(opts.logs, 'utf8') : raw.spokenLogs || '';
  const result = scoreCall({
    turns: raw.turns || raw,
    spokenLogs,
    spokenChunks: raw.spokenChunks,
  });
  const payload = {
    callSid: raw.callSid || null,
    pass: result.pass,
    voiceFailIds: result.voiceFailIds,
    voiceFails: result.voiceFails,
    brainNotes: result.brainNotes,
    spokenChunkCount: result.spokenChunkCount,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(result.pass ? 0 : 1);
}

main();
