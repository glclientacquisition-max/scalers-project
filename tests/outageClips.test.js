const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pcmToWav } = require('../src/speech/wavPack');
const { assessPackagedClip, MIN_PACKAGED_MS } = require('../scripts/check-outage-clips');
const {
  loadOutageClip,
  cacheClip,
  resetOutageClipCache,
  getOutageClipStatus,
  packagedPath,
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

  it('reports clip readiness without decoding wav', () => {
    const empty = getOutageClipStatus();
    assert.equal(empty.en, false);
    assert.equal(empty.sw, false);
    assert.equal(empty.source.en, null);
    assert.equal(empty.source.sw, null);
    assert.equal(empty.packaged.missing, true);
    assert.equal(empty.packaged.en, false);
    assert.equal(empty.packaged.sw, false);
    assert.equal(empty.defaultVoice, getDefaultVoiceId());
    const pcm = Buffer.alloc(320);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    const status = getOutageClipStatus();
    assert.equal(status.en, true);
    assert.equal(status.sw, false);
    assert.equal(status.source.en, 'packaged');
    assert.equal(status.packaged.en, true);
    assert.equal(status.packaged.missing, true);
  });

  it('loads packaged clips from disk when memory is empty', () => {
    resetOutageClipCache();
    const pcm = Buffer.alloc(3200);
    pcm.writeInt16LE(77, 0);
    fs.writeFileSync(path.join(dir, 'downtime-en.wav'), pcmToWav(pcm, 16000));
    fs.writeFileSync(path.join(dir, 'downtime-sw.wav'), pcmToWav(pcm, 16000));
    const status = getOutageClipStatus();
    assert.equal(status.source.en, 'packaged');
    assert.equal(status.packaged.missing, false);
    const clip = loadOutageClip('en');
    assert.equal(clip.source, 'packaged');
    assert.equal(clip.pcm.readInt16LE(0), 77);
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

describe('packaged outage clips on disk', () => {
  let prevClipDir;
  let prevTmpDir;
  let tmp;

  beforeEach(() => {
    resetOutageClipCache();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalers-outage-tmp-'));
    prevClipDir = process.env.VOICE_OUTAGE_CLIP_DIR;
    prevTmpDir = process.env.VOICE_OUTAGE_TMP_DIR;
    delete process.env.VOICE_OUTAGE_CLIP_DIR;
    process.env.VOICE_OUTAGE_TMP_DIR = tmp;
  });

  afterEach(() => {
    resetOutageClipCache();
    if (prevClipDir == null) delete process.env.VOICE_OUTAGE_CLIP_DIR;
    else process.env.VOICE_OUTAGE_CLIP_DIR = prevClipDir;
    if (prevTmpDir == null) delete process.env.VOICE_OUTAGE_TMP_DIR;
    else process.env.VOICE_OUTAGE_TMP_DIR = prevTmpDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports git WAVs without a warm and loads them when memory is empty', () => {
    const status = getOutageClipStatus();
    const enOnDisk = fs.existsSync(packagedPath('en'));
    const swOnDisk = fs.existsSync(packagedPath('sw'));
    assert.equal(status.packaged.en, enOnDisk);
    assert.equal(status.packaged.sw, swOnDisk);
    assert.equal(status.packaged.missing, !(enOnDisk && swOnDisk));
    assert.equal(status.source.en, enOnDisk ? 'packaged' : null);
    if (!enOnDisk) return;
    const clip = loadOutageClip('en');
    assert.equal(clip.source, 'packaged');
    assert.ok(clip.pcm.length > 16000);
  });

  it('rejects a short packaged wav and accepts one long enough to speak', () => {
    assert.equal(assessPackagedClip(path.join(tmp, 'missing.wav')).ok, false);
    const shortPath = path.join(tmp, 'short.wav');
    fs.writeFileSync(shortPath, pcmToWav(Buffer.alloc(320), 16000));
    const short = assessPackagedClip(shortPath);
    assert.equal(short.ok, false);
    assert.match(short.reason, /shorter than/);
    const longPath = path.join(tmp, 'long.wav');
    const samples = Math.ceil((MIN_PACKAGED_MS / 1000) * 16000);
    fs.writeFileSync(longPath, pcmToWav(Buffer.alloc(samples * 2), 16000));
    const long = assessPackagedClip(longPath);
    assert.equal(long.ok, true);
    assert.ok(long.ms >= MIN_PACKAGED_MS);
  });
});
