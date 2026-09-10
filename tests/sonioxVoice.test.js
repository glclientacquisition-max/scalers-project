// Curated Soniox voice catalog + tenant resolver.
// Run: node --test tests/sonioxVoice.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const {
  SCALERS_SONIOX_VOICE_ID,
  resolveSonioxVoice,
  resolveSonioxTtsModel,
  shouldRecomputeVoiceStatus,
  isUuidVoice,
  isAllowedVoiceId,
} = require('../src/speech/sonioxVoice');
const {
  getDefaultVoiceId,
  resolveCuratedVoiceId,
} = require('../src/speech/sonioxVoiceCatalog');

describe('sonioxVoice catalog', () => {
  it('default voice is the Scalers clone UUID', () => {
    assert.equal(getDefaultVoiceId(), '7b197f3c-84b4-4404-986f-114e4dac1432');
    assert.equal(SCALERS_SONIOX_VOICE_ID, getDefaultVoiceId());
  });

  it('resolveSonioxVoice uses tenant id when allowlisted', () => {
    const id = getDefaultVoiceId();
    assert.equal(resolveSonioxVoice(id), id);
    assert.equal(resolveSonioxVoice(null), id);
    assert.equal(resolveCuratedVoiceId('not-a-real-voice'), id);
  });

  it('ttsVoiceNeedsSwap is false for null vs default clone', () => {
    const { ttsVoiceNeedsSwap } = require('../src/speech/sonioxVoice');
    const id = getDefaultVoiceId();
    assert.equal(ttsVoiceNeedsSwap(null, undefined), false);
    assert.equal(ttsVoiceNeedsSwap(id, null), false);
    assert.equal(ttsVoiceNeedsSwap(id, 'not-a-real-voice'), false);
  });

  it('rejects unknown tenant voice ids', () => {
    assert.equal(isAllowedVoiceId('Adrian'), false);
    assert.equal(resolveSonioxVoice('Adrian'), getDefaultVoiceId());
  });

  it('isUuidVoice detects UUID voice ids', () => {
    assert.equal(isUuidVoice(SCALERS_SONIOX_VOICE_ID), true);
    assert.equal(isUuidVoice('Adrian'), false);
  });

  it('remaps retired tts-rt-v1 to tts-rt-v2', () => {
    const prev = process.env.SONIOX_TTS_MODEL;
    try {
      delete process.env.SONIOX_TTS_MODEL;
      assert.equal(resolveSonioxTtsModel(), 'tts-rt-v2');
      assert.equal(resolveSonioxTtsModel('tts-rt-v1'), 'tts-rt-v2');
      process.env.SONIOX_TTS_MODEL = 'tts-rt-v1';
      assert.equal(resolveSonioxTtsModel(), 'tts-rt-v2');
      assert.equal(resolveSonioxTtsModel('tts-rt-v2'), 'tts-rt-v2');
    } finally {
      if (prev == null) delete process.env.SONIOX_TTS_MODEL;
      else process.env.SONIOX_TTS_MODEL = prev;
    }
  });

  it('recomputes clone voices that are missing on the live model', () => {
    assert.equal(shouldRecomputeVoiceStatus('not_computed'), true);
    assert.equal(shouldRecomputeVoiceStatus('missing'), true);
    assert.equal(shouldRecomputeVoiceStatus('ready'), false);
    assert.equal(shouldRecomputeVoiceStatus('computing'), false);
  });

  it('ensureSonioxVoiceReady recomputes when GET status is missing', async () => {
    const { ensureSonioxVoiceReady, listCuratedVoices } = require('../src/speech/sonioxVoice');
    const prevKey = process.env.SONIOX_API_KEY;
    const prevModel = process.env.SONIOX_TTS_MODEL;
    process.env.SONIOX_API_KEY = 'test-key';
    process.env.SONIOX_TTS_MODEL = 'tts-rt-v1';
    const recomputed = new Set();
    const origFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (/\/recompute\/?$/.test(u)) {
        const id = decodeURIComponent(u.split('/').slice(-2, -1)[0]);
        recomputed.add(id);
        const body = JSON.parse(opts.body || '{}');
        assert.equal(body.model, 'tts-rt-v2');
        return { ok: true, json: async () => ({}), text: async () => '' };
      }
      const id = decodeURIComponent(u.split('/').pop());
      return {
        ok: true,
        json: async () => ({
          models: recomputed.has(id)
            ? [{ model: 'tts-rt-v2', status: 'ready' }]
            : [],
        }),
      };
    };
    const logs = [];
    try {
      const result = await ensureSonioxVoiceReady({ log: (line) => logs.push(line) });
      assert.equal(result.ok, true);
      assert.ok(recomputed.size >= 1);
      assert.equal(recomputed.size, listCuratedVoices().length);
      assert.ok(logs.some((line) => /retired/.test(line)));
      assert.ok(logs.some((line) => /recompute/.test(line)));
    } finally {
      global.fetch = origFetch;
      if (prevKey == null) delete process.env.SONIOX_API_KEY;
      else process.env.SONIOX_API_KEY = prevKey;
      if (prevModel == null) delete process.env.SONIOX_TTS_MODEL;
      else process.env.SONIOX_TTS_MODEL = prevModel;
    }
  });

  it('fallback catalog loads from src/data (Railway Docker has no dashboard/)', () => {
    const fs = require('fs');
    const path = require('path');
    const srcCatalog = path.join(__dirname, '../src/data/soniox-voices.json');
    assert.ok(fs.existsSync(srcCatalog), 'src/data/soniox-voices.json missing');
    // Catalog module must not require() dashboard paths (breaks Dockerfile image).
    const src = fs.readFileSync(
      path.join(__dirname, '../src/speech/sonioxVoiceCatalog.js'),
      'utf8'
    );
    assert.equal(
      /require\([^)]*dashboard\//.test(src),
      false,
      'sonioxVoiceCatalog.js must not require dashboard/ (omitted from Railway image)'
    );
    assert.match(src, /require\(['"]\.\.\/data\/soniox-voices\.json['"]\)/);
  });
});
