// WAV pack helper for desk preview playback.
// Run: node --test tests/wavPack.test.js

const assert = require('assert');
const http = require('http');
const express = require('express');
const { describe, it } = require('node:test');
const {
  pcmToWav,
  pcmToBrowserWav,
  writeWavResponse,
  BROWSER_PREVIEW_RATE,
} = require('../src/speech/wavPack');

describe('pcmToWav', () => {
  it('wraps mono s16le PCM in a valid RIFF header', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-500, 2);
    const wav = pcmToWav(pcm, 16000);
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.length, 44 + pcm.length);
  });
});

describe('pcmToBrowserWav', () => {
  it('emits 44.1 kHz PCM WAV for browser audio/wav playback', () => {
    const pcm = Buffer.alloc(3200);
    for (let i = 0; i < 1600; i++) pcm.writeInt16LE(i % 200, i * 2);
    const wav = pcmToBrowserWav(pcm, 16000);
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), BROWSER_PREVIEW_RATE);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal((wav.length - 44) % 2, 0);
    assert.ok(wav.length > 44);
  });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

describe('writeWavResponse', () => {
  it('ends with a Node Buffer of RIFF bytes', () => {
    const wav = pcmToWav(Buffer.alloc(4), 16000);
    const headers = {};
    let ended;
    const res = {
      getHeader(name) {
        return headers[String(name).toLowerCase()];
      },
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = value;
      },
      end(body) {
        ended = body;
      },
    };
    writeWavResponse(res, wav);
    assert.ok(Buffer.isBuffer(ended));
    assert.equal(ended.slice(0, 4).toString(), 'RIFF');
    assert.equal(headers['content-type'], 'audio/wav');
    assert.equal(headers['content-length'], String(wav.length));
  });

  it('Express res.send(Uint8Array) is not raw WAV', async () => {
    const wav = pcmToWav(Buffer.alloc(4), 16000);
    const app = express();
    app.get('/bad', (_req, res) => {
      res.set('Content-Type', 'audio/wav');
      res.send(new Uint8Array(wav));
    });
    const { server, port } = await listen(app);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/bad`);
      const body = Buffer.from(await r.arrayBuffer());
      assert.notEqual(body.slice(0, 4).toString(), 'RIFF');
      assert.equal(String.fromCharCode(body[0]), '{');
    } finally {
      server.close();
    }
  });

  it('sends RIFF bytes the desk can accept', async () => {
    const wav = pcmToBrowserWav(Buffer.alloc(3200), 16000);
    const app = express();
    app.get('/preview', (_req, res) => {
      res.set('Content-Type', 'audio/wav');
      writeWavResponse(res, wav);
    });
    const { server, port } = await listen(app);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/preview`);
      const body = Buffer.from(await r.arrayBuffer());
      assert.equal(r.status, 200);
      assert.match(String(r.headers.get('content-type') || ''), /audio\/wav/);
      assert.equal(body.slice(0, 4).toString(), 'RIFF');
      assert.equal(body.slice(8, 12).toString(), 'WAVE');
      assert.equal(body.length, wav.length);
    } finally {
      server.close();
    }
  });
});
