#!/usr/bin/env node
/**
 * Smoke: TTS speaking pace (tempo), not call latency.
 *
 * 1) Confirms default speedForLanguage('en') === 1.08 when env unset
 * 2) If SONIOX_API_KEY is set, synthesizes the same line at 0.95 and 1.08
 *    and checks the faster setting produces shorter PCM duration
 *
 * Usage: node scripts/smoke-tts-pace.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
  speedForLanguage,
  SAMPLE_RATE,
} = require('../src/speech/sonioxTts');

const TEXT =
  "Hello, you've reached ChapterOne Bookstore, this is Aisha speaking. " +
  'We are on Muindi Mbingu Street opposite City Market Fashion Mall.';

const OUT_DIR = path.join(__dirname, '../output/tts-pace-smoke');

function writeWav(filePath, pcm, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  fs.writeFileSync(filePath, buffer);
}

async function synthesize(text, speed) {
  const chunks = [];
  const session = createSonioxTtsSession({
    callSid: `tts-pace-smoke-${speed}`,
    onAudio: (pcm) => {
      if (pcm?.length) chunks.push(pcm);
    },
  });
  await session.ready;
  try {
    const result = await session.speak(text, {
      language: 'en',
      speed,
      alreadyPrepared: true,
    });
    if (result?.empty) return Buffer.alloc(0);
    return Buffer.concat(chunks);
  } finally {
    session.close();
  }
}

function pcmDurationMs(pcm) {
  // pcm_s16le mono
  const samples = pcm.length / 2;
  return (samples / SAMPLE_RATE) * 1000;
}

async function main() {
  console.log('=== TTS pace smoke ===');

  // Module may have loaded with env already set — report effective defaults.
  const effectiveEn = speedForLanguage('en');
  const envSpeed = process.env.SONIOX_TTS_SPEED || '(unset → code default 1.08)';
  console.log(`SONIOX_TTS_SPEED env: ${envSpeed}`);
  console.log(`speedForLanguage(en): ${effectiveEn}`);

  if (!process.env.SONIOX_TTS_SPEED && effectiveEn !== 1.08) {
    console.error('FAIL: expected default EN speed 1.08');
    process.exit(1);
  }
  console.log('PASS: default/effective EN speed wiring looks good');

  if (!isSonioxTtsConfigured()) {
    console.log(
      'SKIP live audio: SONIOX_API_KEY not set — cannot measure PCM duration.'
    );
    console.log(
      'Add SONIOX_API_KEY (and SONIOX_VOICE if needed) then re-run for A/B tempo proof.'
    );
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const slow = 0.95;
  const fast = 1.08;

  console.log(`Synthesizing at speed=${slow} …`);
  const pcmSlow = await synthesize(TEXT, slow);
  console.log(`Synthesizing at speed=${fast} …`);
  const pcmFast = await synthesize(TEXT, fast);

  if (!pcmSlow.length || !pcmFast.length) {
    console.error('FAIL: empty PCM from Soniox');
    process.exit(1);
  }

  const msSlow = pcmDurationMs(pcmSlow);
  const msFast = pcmDurationMs(pcmFast);
  const ratio = msFast / msSlow;

  const slowPath = path.join(OUT_DIR, `pace-${slow}.wav`);
  const fastPath = path.join(OUT_DIR, `pace-${fast}.wav`);
  writeWav(slowPath, pcmSlow);
  writeWav(fastPath, pcmFast);

  console.log(
    JSON.stringify(
      {
        textChars: TEXT.length,
        sampleRate: SAMPLE_RATE,
        slowMs: Math.round(msSlow),
        fastMs: Math.round(msFast),
        ratio: Number(ratio.toFixed(3)),
        expected: 'fastMs < slowMs (higher speed = shorter audio)',
        slowWav: slowPath,
        fastWav: fastPath,
      },
      null,
      2
    )
  );

  // Expect ~0.95/1.08 ≈ 0.88 duration ratio; allow noise/jitter.
  if (!(msFast < msSlow * 0.97)) {
    console.error(
      `FAIL: speed ${fast} was not meaningfully shorter than ${slow} (${Math.round(msFast)} vs ${Math.round(msSlow)} ms)`
    );
    process.exit(1);
  }

  console.log(
    `PASS: tempo confirmed — ${fast} is ${Math.round((1 - ratio) * 100)}% shorter audio than ${slow}`
  );
}

main().catch((err) => {
  console.error('FAIL:', err?.message || err);
  process.exit(1);
});
