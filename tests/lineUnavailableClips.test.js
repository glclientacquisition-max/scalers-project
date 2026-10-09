'use strict';

// Public phone-system clips for Voice <Play> (archived or suspended business,
// #639). Served from dashboard/public/audio with no auth and a long cache.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDIO = path.join(ROOT, 'dashboard', 'public', 'audio');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function wavInfo(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  return { format: b.readUInt16LE(20), channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34) };
}

// line-unavailable-*: archived or suspended business (#639).
// downtime-*: the outage clips from #587.
const CLIPS = ['line-unavailable', 'downtime'];

describe('phone-system clips', () => {
  for (const [name, lang] of CLIPS.flatMap((n) => [[n, 'en'], [n, 'sw']])) {
    it(`${name}-${lang}: 16 kHz mono 16-bit PCM WAV and an MP3, versioned names`, () => {
      const wav = path.join(AUDIO, `${name}-${lang}.v1.wav`);
      assert.deepEqual(wavInfo(wav), { format: 1, channels: 1, rate: 16000, bits: 16 });
      const seconds = (fs.statSync(wav).size - 44) / (16000 * 2);
      assert.ok(seconds > 1 && seconds < 15, `${seconds}s`);
      const mp3 = fs.readFileSync(path.join(AUDIO, `${name}-${lang}.v1.mp3`));
      assert.ok(mp3.length > 1000);
      assert.ok(mp3.toString('ascii', 0, 3) === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), 'mp3 header');
    });
  }

  it('no auth proxy runs on /audio/*', () => {
    const proxy = read('dashboard/src/proxy.ts');
    const m = proxy.match(/matcher:\s*\[\s*"([^"]+)"\s*\]/);
    assert.ok(m, 'one matcher');
    const re = new RegExp(`^${m[1]}$`);
    assert.equal(re.test('/audio/line-unavailable-en.v1.wav'), false);
    assert.equal(re.test('/audio/downtime-en.v1.wav'), false);
    assert.equal(re.test('/audio/downtime-sw.v1.mp3'), false);
    // Everything else still goes through it.
    for (const p of ['/admin', '/admin/businesses', '/login', '/home', '/api/admin/billing', '/audiobooks']) {
      assert.equal(re.test(p), true, p);
    }
  });

  it('long immutable public cache on /audio/*', () => {
    const conf = read('dashboard/next.config.ts');
    assert.match(conf, /source: "\/audio\/:file\*"/);
    assert.match(conf, /"public, max-age=31536000, immutable"/);
  });
});
