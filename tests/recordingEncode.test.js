const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pcmToWav } = require('../src/speech/wavPack');
const {
  encodeWavToMp3,
  prepareRecordingForUpload,
  isMp3Buffer,
  expectedMp3BytesPerSecond,
  DEFAULT_MP3_KBPS,
} = require('../src/sautikit/recordingEncode');

function makeWav(seconds = 0.25, sampleRate = 8000) {
  const samples = Math.floor(sampleRate * seconds);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.sin((i / sampleRate) * Math.PI * 440) * 12000, i * 2);
  }
  return pcmToWav(pcm, sampleRate);
}

describe('recordingEncode', () => {
  it('WAV encodes to a smaller valid MP3', async () => {
    const wav = makeWav(0.5, 8000);
    const mp3 = await encodeWavToMp3(wav);
    assert.ok(isMp3Buffer(mp3));
    assert.ok(mp3.length < wav.length * 0.6, 'MP3 should be much smaller than WAV');
  });

  it('prepareRecordingForUpload falls back to WAV when PCM is empty', async () => {
    const emptyWav = pcmToWav(Buffer.alloc(0), 8000);
    const out = await prepareRecordingForUpload(emptyWav, 'audio/wav', 'wav');
    assert.equal(out.extension, 'wav');
    assert.ok(out.encodeError);
    assert.equal(out.buffer, emptyWav);
  });

  it('passes MP3 through unchanged', async () => {
    const wav = makeWav(0.05, 8000);
    const mp3 = await encodeWavToMp3(wav);
    const out = await prepareRecordingForUpload(mp3, 'audio/mpeg', 'mp3');
    assert.equal(out.extension, 'mp3');
    assert.equal(out.buffer, mp3);
    assert.equal(out.encoded, false);
  });

  it('expected size per minute at default kbps', () => {
    const perSec = expectedMp3BytesPerSecond(DEFAULT_MP3_KBPS);
    assert.equal(perSec, 3000);
    assert.equal(perSec * 60, 180_000, '~180 KB per minute at 24 kbps CBR');
  });
});
