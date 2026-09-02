#!/usr/bin/env node
// Render clone-voice downtime clips (same Soniox voice as the live greeting).
// Requires SONIOX_API_KEY. Writes src/speech/pcm/downtime-en.wav and downtime-sw.wav.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { synthesizeTtsPreview } = require('../src/speech/ttsPreview');
const { pickSpeechOutageLine } = require('../src/speech/outageCopy');
const { isSonioxTtsConfigured } = require('../src/speech/sonioxTts');

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
  fs.writeFileSync(dest, result.wav);
  console.log(`[render-outage-clips] wrote ${dest} bytes=${result.wav.length}`);
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
