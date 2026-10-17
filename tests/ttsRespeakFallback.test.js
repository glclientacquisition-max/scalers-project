// VOICE_TTS_RESPEAK line fallback chain: local clip of this exact line →
// espeak-ng → Gemini TTS. Never the downtime clip for a single lost line.
// Run: node --test tests/ttsRespeakFallback.test.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const emergency = require('../src/speech/emergencyTts');
const { fillerPcmKey, putFillerPcm, resetFillerPcmCache } = require('../src/speech/fillerPcmCache');
const { createLineFallback, localLinePcm } = require('../src/speech/ttsRespeak');

const origEspeak = emergency.synthesizeWithEspeak;
const origGemini = emergency.synthesizeWithGemini;
const origWarn = console.warn;

beforeEach(() => {
  console.warn = () => {};
  resetFillerPcmCache();
});
afterEach(() => {
  emergency.synthesizeWithEspeak = origEspeak;
  emergency.synthesizeWithGemini = origGemini;
  console.warn = origWarn;
});

describe('synthesizeLinePcm', () => {
  it('uses the local clip first', async () => {
    emergency.synthesizeWithEspeak = async () => assert.fail('espeak not needed');
    const out = await emergency.synthesizeLinePcm('Mm.', {
      language: 'sw',
      localPcm: () => Buffer.alloc(100, 7),
    });
    assert.equal(out.source, 'local_clip');
    assert.equal(out.pcm.length, 100);
  });

  it('then espeak-ng with the line text and language', async () => {
    const seen = [];
    emergency.synthesizeWithEspeak = async (text, lang) => {
      seen.push([text, lang]);
      return Buffer.alloc(200);
    };
    emergency.synthesizeWithGemini = async () => assert.fail('gemini not needed');
    const out = await emergency.synthesizeLinePcm('  Pole sana   kwa tatizo hili. ', { language: 'sw', localPcm: () => null });
    assert.equal(out.source, 'espeak');
    assert.deepEqual(seen, [['Pole sana kwa tatizo hili.', 'sw']]);
  });

  it('then Gemini, bounded', async () => {
    emergency.synthesizeWithEspeak = async () => {
      const err = new Error('spawn espeak-ng ENOENT');
      err.code = 'ENOENT';
      throw err;
    };
    emergency.synthesizeWithGemini = async () => Buffer.alloc(300);
    const out = await emergency.synthesizeLinePcm('Hello.', { language: 'en' });
    assert.equal(out.source, 'gemini');

    emergency.synthesizeWithGemini = () => new Promise(() => {});
    const t0 = Date.now();
    const none = await emergency.synthesizeLinePcm('Hello.', { language: 'en', geminiMs: 30 });
    assert.equal(none, null);
    assert.ok(Date.now() - t0 < 500);
  });

  it('never speaks the downtime clip for a single lost line', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/speech/emergencyTts.js'), 'utf8');
    const body = src.slice(src.indexOf('async function synthesizeLinePcm'), src.indexOf('module.exports = {'));
    assert.doesNotMatch(body, /loadOutageClip|pickSpeechOutageLine/);
  });
});

describe('ttsRespeak local clip', () => {
  it('finds the cached filler PCM for the exact prepared line at the same speed', () => {
    const key = fillerPcmKey({ voiceId: 'v1', language: 'sw', spokenText: 'Sawa.', speed: 1 });
    putFillerPcm(key, Buffer.alloc(64, 1));
    assert.equal(localLinePcm({ voiceId: 'v1', text: ' Sawa. ', language: 'sw', speed: 1 }).length, 64);
    assert.equal(localLinePcm({ voiceId: 'v1', text: 'Sawa.', language: 'sw', speed: 0.9 }), null, 'different pace');
    assert.equal(localLinePcm({ voiceId: 'v1', text: 'Sawa sawa.', language: 'sw', speed: 1 }), null);
  });

  it('createLineFallback passes language and the local clip lookup through', async () => {
    const key = fillerPcmKey({ voiceId: 'v2', language: 'en', spokenText: 'Alright.', speed: 1 });
    putFillerPcm(key, Buffer.alloc(32, 1));
    const fb = createLineFallback({ voiceId: () => 'v2' });
    emergency.synthesizeWithEspeak = async () => assert.fail('local clip should win');
    const out = await fb('Alright.', { language: 'en', speed: 1 });
    assert.equal(out.source, 'local_clip');
  });
});

describe('server wiring', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('passes the fallback chain and the barge / call-ended guard to the TTS session', () => {
    const bind = server.slice(server.indexOf('function bindMediaTts'), server.indexOf('tts = session;'));
    assert.match(bind, /fallbackPcm:\s*createLineFallback\(/);
    assert.match(bind, /shouldRespeak:\s*\(\)\s*=>[\s\S]*bargeInActive[\s\S]*speechOutageStarted[\s\S]*ws\.readyState/);
  });
});
