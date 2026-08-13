// Curated Soniox voice catalog + tenant resolver.
// Run: node --test tests/sonioxVoice.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const {
  SCALERS_SONIOX_VOICE_ID,
  resolveSonioxVoice,
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

  it('rejects unknown tenant voice ids', () => {
    assert.equal(isAllowedVoiceId('Adrian'), false);
    assert.equal(resolveSonioxVoice('Adrian'), getDefaultVoiceId());
  });

  it('isUuidVoice detects UUID voice ids', () => {
    assert.equal(isUuidVoice(SCALERS_SONIOX_VOICE_ID), true);
    assert.equal(isUuidVoice('Adrian'), false);
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
