const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pcmToWav } = require('../src/speech/wavPack');
const {
  loadOutageClip,
  cacheClip,
  resetOutageClipCache,
  getOutageClipStatus,
} = require('../src/speech/outageClips');
const { getDefaultVoiceId } = require('../src/speech/sonioxVoiceCatalog');

describe('outageClips', () => {
  let dir;
  let prevClipDir;
  let prevTmpDir;

  beforeEach(() => {
    resetOutageClipCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-outage-'));
    prevClipDir = process.env.VOICE_OUTAGE_CLIP_DIR;
    prevTmpDir = process.env.VOICE_OUTAGE_TMP_DIR;
    process.env.VOICE_OUTAGE_CLIP_DIR = dir;
    process.env.VOICE_OUTAGE_TMP_DIR = dir;
  });

  afterEach(() => {
    resetOutageClipCache();
    if (prevClipDir == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
    else process.env.VOICE_OUTAGE_CLIP_DIR = prevClipDir;
    if (prevTmpDir == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
    else process.env.VOICE_OUTAGE_TMP_DIR = prevTmpDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads a packaged clone-voice downtime wav', () => {
    const pcm = Buffer.alloc(320);
    pcm.writeInt16LE(1800, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    const clip = loadOutageClip('en');
    assert.ok(clip);
    assert.equal(clip.source, 'packaged');
    assert.equal(clip.language, 'en');
    assert.equal(clip.pcm.readInt16LE(0), 1800);
  });

  it('falls back to English clip when Kiswahili file is missing', () => {
    const pcm = Buffer.alloc(320);
    pcm.writeInt16LE(900, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    const clip = loadOutageClip('sw');
    assert.ok(clip);
    assert.equal(clip.language, 'en');
  });

  it('uses the default clone clip when the tenant voice is not in the catalog', () => {
    const pcm = Buffer.alloc(320);
    pcm.writeInt16LE(100, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    const fallback = loadOutageClip('en', {
      voiceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    assert.equal(fallback.source, 'packaged');
    assert.equal(fallback.voiceId, getDefaultVoiceId());
    const status = getOutageClipStatus();
    assert.equal(status.en, true);
    assert.equal(status.defaultVoice, getDefaultVoiceId());
  });

  it('prefers an in-memory warmed clip over disk', () => {
    const disk = Buffer.alloc(320);
    disk.writeInt16LE(1, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(disk, 16000));
    const live = Buffer.alloc(320);
    live.writeInt16LE(42, 0);
    cacheClip('en', live, 'soniox');
    const clip = loadOutageClip('unknown');
    assert.equal(clip.source, 'memory');
    assert.equal(clip.pcm.readInt16LE(0), 42);
  });
});
