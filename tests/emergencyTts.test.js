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
  SILENT_OUTAGE_HANGUP_MS,
  synthesizeEmergencyPcm,
  planSpeechOutagePlayback,
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-empty-'));
    const prevClip = process.env.VOICE_OUTAGE_CLIP_DIR;
    const prevTmp = process.env.VOICE_OUTAGE_TMP_DIR;
    const prev = process.env.GEMINI_API_KEY;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
    delete process.env.GEMINI_API_KEY;
    resetOutageClipCache();
    try {
      const pcm = await synthesizeEmergencyPcm('Hello', { language: 'en' });
      // espeak-ng may be installed on the agent VM. Either a Buffer or null is ok;
      // never throw, and never return an empty buffer.
      if (pcm) {
        assert.ok(Buffer.isBuffer(pcm));
        assert.ok(pcm.length > 0);
      } else {
        assert.equal(pcm, null);
      }
    } finally {
      resetOutageClipCache();
      if (prev != null) process.env.GEMINI_API_KEY = prev;
      else delete process.env.GEMINI_API_KEY;
      if (prevClip == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
      else process.env.VOICE_OUTAGE_CLIP_DIR = prevClip;
      if (prevTmp == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
      else process.env.VOICE_OUTAGE_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
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

  it('billing path speaks a packaged clip and does not use the silent hangup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-bill-'));
    const prevClip = process.env.VOICE_OUTAGE_CLIP_DIR;
    const prevTmp = process.env.VOICE_OUTAGE_TMP_DIR;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
    resetOutageClipCache();
    const pcm = Buffer.alloc(32000);
    pcm.writeInt16LE(55, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    let geminiCalls = 0;
    try {
      const plan = await planSpeechOutagePlayback({
        language: 'en',
        skipGemini: true,
        synthesizeEspeak: async () => {
          throw new Error('espeak should not run when a clip exists');
        },
        synthesizeGemini: async () => {
          geminiCalls += 1;
          return Buffer.alloc(320);
        },
      });
      assert.equal(plan.speak, true);
      assert.equal(plan.pcm.readInt16LE(0), 55);
      assert.equal(plan.hangupMs, 1200);
      assert.equal(geminiCalls, 0);
      assert.equal(plan.line, OUTAGE_LINE_EN);
    } finally {
      resetOutageClipCache();
      if (prevClip == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
      else process.env.VOICE_OUTAGE_CLIP_DIR = prevClip;
      if (prevTmp == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
      else process.env.VOICE_OUTAGE_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('billing path speaks espeak and skips Gemini when memory and disk are empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-espeak-'));
    const prevClip = process.env.VOICE_OUTAGE_CLIP_DIR;
    const prevTmp = process.env.VOICE_OUTAGE_TMP_DIR;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
    resetOutageClipCache();
    let geminiCalls = 0;
    const spoken = Buffer.alloc(32000);
    spoken.writeInt16LE(9, 0);
    try {
      const plan = await planSpeechOutagePlayback({
        language: 'sw',
        skipGemini: true,
        synthesizeEspeak: async () => spoken,
        synthesizeGemini: async () => {
          geminiCalls += 1;
          return Buffer.alloc(320);
        },
      });
      assert.equal(geminiCalls, 0);
      assert.equal(plan.speak, true);
      assert.equal(plan.pcm, spoken);
      assert.equal(plan.line, OUTAGE_LINE_SW);
      assert.equal(plan.hangupMs, 1200);
    } finally {
      resetOutageClipCache();
      if (prevClip == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
      else process.env.VOICE_OUTAGE_CLIP_DIR = prevClip;
      if (prevTmp == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
      else process.env.VOICE_OUTAGE_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hangs up at 800ms only when the clip and espeak both fail', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-silent-'));
    const prevClip = process.env.VOICE_OUTAGE_CLIP_DIR;
    const prevTmp = process.env.VOICE_OUTAGE_TMP_DIR;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
    resetOutageClipCache();
    let geminiCalls = 0;
    try {
      const plan = await planSpeechOutagePlayback({
        language: 'en',
        skipGemini: true,
        synthesizeEspeak: async () => {
          throw new Error('espeak-ng missing');
        },
        synthesizeGemini: async () => {
          geminiCalls += 1;
          return Buffer.alloc(800);
        },
      });
      assert.equal(plan.speak, false);
      assert.equal(plan.pcm, null);
      assert.equal(plan.hangupMs, SILENT_OUTAGE_HANGUP_MS);
      assert.equal(geminiCalls, 0);
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
