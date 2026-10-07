#!/usr/bin/env node
// Fail if the default-clone downtime WAVs are missing from git.
// Render them with SONIOX_API_KEY: node scripts/render-outage-clips.js

const fs = require('fs');
const path = require('path');
const { wavBytesTo16kPcm, pcmDurationMs } = require('../src/speech/pcmUtil');

const MIN_PACKAGED_MS = 800;
const OUT_DIR = path.join(__dirname, '../src/speech/pcm');

function assessPackagedClip(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing' };
  }
  let pcm;
  try {
    pcm = wavBytesTo16kPcm(fs.readFileSync(filePath));
  } catch (err) {
    return { ok: false, reason: err?.message || 'unreadable' };
  }
  const ms = pcmDurationMs(pcm, 16000);
  if (!pcm?.length || ms < MIN_PACKAGED_MS) {
    return { ok: false, reason: `shorter than ${MIN_PACKAGED_MS}ms (${ms}ms)`, ms };
  }
  return { ok: true, ms, bytes: pcm.length };
}

function checkPackagedOutageClips(dir = OUT_DIR) {
  return ['en', 'sw'].map((lang) => {
    const filePath = path.join(dir, `downtime-${lang}.wav`);
    return { lang, filePath, ...assessPackagedClip(filePath) };
  });
}

function main() {
  const rows = checkPackagedOutageClips();
  let failed = false;
  for (const row of rows) {
    if (!row.ok) {
      failed = true;
      console.error(
        `[check-outage-clips] downtime-${row.lang}.wav ${row.reason}. ` +
          'Render with SONIOX_API_KEY: node scripts/render-outage-clips.js'
      );
    } else {
      console.log(
        `[check-outage-clips] downtime-${row.lang}.wav ok ms=${row.ms} bytes=${row.bytes}`
      );
    }
  }
  if (failed) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  MIN_PACKAGED_MS,
  assessPackagedClip,
  checkPackagedOutageClips,
};
