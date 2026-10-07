/* eslint-disable @typescript-eslint/no-require-imports */
// Prefer Voice's scorer when phase 1 has landed on disk. The desk deploy
// does not ship src/speech, so production reads use the snapshot.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const LIVE_VOICE_SCORE = path.resolve(__dirname, "../../../../src/speech/voiceScore.js");

function voiceScoreOrigin() {
  if (fs.existsSync(LIVE_VOICE_SCORE)) return { kind: "live", file: LIVE_VOICE_SCORE };
  return { kind: "snapshot", file: path.join(__dirname, "voiceScoreSnapshot.js") };
}

function loadVoiceScore() {
  const origin = voiceScoreOrigin();
  if (origin.kind === "live") return createRequire(__filename)(origin.file);
  return require("./voiceScoreSnapshot");
}

module.exports = {
  LIVE_VOICE_SCORE,
  loadVoiceScore,
  voiceScoreOrigin,
};
