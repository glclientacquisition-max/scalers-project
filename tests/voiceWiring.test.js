// Static wiring checks for runtime-only voice paths that syntax checks miss.
// Run: node tests/voiceWiring.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

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

console.log('Voice runtime wiring checks passed.');
