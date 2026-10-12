#!/usr/bin/env node
// Render clone-voice downtime clips (same Soniox voice as the live greeting).
// Requires SONIOX_API_KEY. Writes src/speech/pcm/downtime-en.wav and downtime-sw.wav.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { synthesizeTtsPreview } = require('../src/speech/ttsPreview');
const { pickSpeechOutageLine } = require('../src/speech/outageCopy');
const { isSonioxTtsConfigured } = require('../src/speech/sonioxTts');
const { assessPackagedClip } = require('./check-outage-clips');
const { pcmToWav } = require('../src/speech/wavPack');
const { resampleS16le } = require('../src/speech/pcmUtil');

const OUT_DIR = path.join(__dirname, '../src/speech/pcm');

async function renderLang(lang) {
  const text = pickSpeechOutageLine(lang);
  console.log(`[render-outage-clips] ${lang}: ${text}`);
  const result = await synthesizeTtsPreview({
    text,
    language: lang,
    callLanguage: lang,
  });
  const dest = path.join(OUT_DIR, `downtime-${lang}.wav`);
  // Package at the call rate (16 kHz mono), not the 44.1 kHz browser preview rate.
  const rate = result.sampleRate || 16000;
  const pcm16k = rate === 16000 ? result.pcm : resampleS16le(result.pcm, rate, 16000);
  const wav = pcmToWav(pcm16k, 16000);
  fs.writeFileSync(dest, wav);
  const check = assessPackagedClip(dest);
  if (!check.ok) {
    throw new Error(`downtime-${lang}.wav ${check.reason}`);
  }
  console.log(
    `[render-outage-clips] wrote ${dest} bytes=${wav.length} pcmMs=${check.ms}`
  );
}

async function main() {
  if (!isSonioxTtsConfigured()) {
    console.error('SONIOX_API_KEY is required to render clone-voice clips.');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await renderLang('en');
  await renderLang('sw');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
