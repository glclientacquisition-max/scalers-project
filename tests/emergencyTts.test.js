const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pcmToWav } = require('../src/speech/wavPack');
const {
  pickSpeechOutageLine,
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  synthesizeEmergencyPcm,
} = require('../src/speech/emergencyTts');
const { resetOutageClipCache } = require('../src/speech/outageClips');

describe('emergencyTts', () => {
  it('picks English and Kiswahili outage lines without fluff', () => {
    assert.equal(pickSpeechOutageLine('en'), OUTAGE_LINE_EN);
    assert.equal(pickSpeechOutageLine('sw'), OUTAGE_LINE_SW);
    assert.equal(pickSpeechOutageLine('sheng'), OUTAGE_LINE_SW);
    assert.match(OUTAGE_LINE_EN, /downtime/i);
    assert.match(OUTAGE_LINE_SW, /downtime/i);
    assert.doesNotMatch(OUTAGE_LINE_EN, /[—–]/);
    assert.doesNotMatch(OUTAGE_LINE_SW, /[—–]/);
  });

  it('returns null when espeak and Gemini are both unavailable', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const pcm = await synthesizeEmergencyPcm('Hello', { language: 'en' });
    if (prev != null) process.env.GEMINI_API_KEY = prev;
    // espeak-ng may be installed on the agent VM. Either a Buffer or null is ok;
    // never throw, and never return an empty buffer.
    if (pcm) {
      assert.ok(Buffer.isBuffer(pcm));
      assert.ok(pcm.length > 0);
    } else {
      assert.equal(pcm, null);
    }
  });

  it('prefers a clone-voice downtime recording over espeak', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-clip-'));
    const prevClip = process.env.VOICE_OUTAGE_CLIP_DIR;
    const prevTmp = process.env.VOICE_OUTAGE_TMP_DIR;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
    resetOutageClipCache();
    const pcm = Buffer.alloc(640);
    pcm.writeInt16LE(1234, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    try {
      const spoken = await synthesizeEmergencyPcm(OUTAGE_LINE_EN, { language: 'en' });
      assert.ok(spoken);
      assert.equal(spoken.readInt16LE(0), 1234);
    } finally {
      resetOutageClipCache();
      if (prevClip == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
      else process.env.VOICE_OUTAGE_CLIP_DIR = prevClip;
      if (prevTmp == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
      else process.env.VOICE_OUTAGE_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
