// Static wiring checks for runtime-only voice paths that syntax checks miss.
// Run: node tests/voiceWiring.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');
const sttPath = path.join(__dirname, '..', 'src/speech/sonioxStt.js');
const sttSource = fs.readFileSync(sttPath, 'utf8');

assert.match(
  source,
  /const\s*\{\s*createSpokenStreamBuffer\s*,?\s*\}\s*=\s*require\(['"]\.\/src\/speech\/spokenStreamBuffer['"]\)/,
  'server.js must import createSpokenStreamBuffer before the streaming turn path uses it'
);

assert.match(
  source,
  /transcriptLog\.push\(`Agent: \$\{AI_FALLBACK_LINE\}`\);\s*await speakText\(AI_FALLBACK_LINE\);/,
  'spoken technical fallbacks must also be persisted in the transcript'
);

assert.match(
  source,
  /classifyFinalDuringAgentSpeech/,
  'media path must classify finals heard during TTS (echo drop vs queue)'
);

assert.match(
  source,
  /filler cancelled for reply audio/,
  'reply path must cancel thinking-ack without awaiting remote TTS terminated'
);

assert.match(
  source,
  /queue overlapping final while TTS/,
  'non-echo finals during TTS must be queued for the next caller turn'
);

assert.match(
  source,
  /function releaseQueuedCallerSpeech/,
  'playback end / barge-in must release queued caller speech'
);

assert.match(
  source,
  /createVoiceTurnTiming/,
  'media turns must record voice-timing markers for speed/consistency'
);

assert.match(
  source,
  /llm→tts stream prefetched/,
  'reply TTS must be prefetched while Gemini starts'
);

assert.match(
  source,
  /Drop filler PCM via generation bump only/,
  'filler stop must not cancel the prefetched reply TTS stream'
);

assert.match(
  source,
  /mergeInterimHypothesis/,
  'barge-in must accumulate interim STT hypotheses'
);

assert.match(
  source,
  /type:\s*['"]killAudio['"]/,
  'media clear must send drachtio killAudio on barge-in'
);

assert.match(
  sttSource,
  /context_used=/,
  'Soniox STT open must log context_used for A/B measurement'
);

assert.match(
  source,
  /contextPromise:/,
  'media path must pass tenant STT contextPromise into createSonioxSttSession'
);

assert.match(
  source,
  /buildSttContext/,
  'media path must build per-tenant Soniox STT context'
);

console.log('Voice runtime wiring checks passed.');
