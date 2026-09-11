const { describe, it } = require('node:test');
const assert = require('assert');
const {
  resolveVoiceProfile,
  speedForLanguage,
  fillerLanguage,
  publicVoiceProfile,
} = require('../src/speech/voiceProfile');

function bareEnv(extra = {}) {
  return { ...extra };
}

describe('voiceProfile', () => {
  it('balanced is the default: same EN/SW pace, phone gain', () => {
    const p = resolveVoiceProfile(bareEnv());
    assert.equal(p.name, 'balanced');
    assert.equal(p.speedEn, 1);
    assert.equal(p.speedSw, 1);
    assert.equal(p.gain, 1.38);
    assert.equal(p.fillerDelayMs, 400);
  });

  it('snappy is slightly quicker with the same EN/SW pace', () => {
    const p = resolveVoiceProfile(bareEnv({ VOICE_PROFILE: 'snappy' }));
    assert.equal(p.name, 'snappy');
    assert.equal(p.speedEn, 1.06);
    assert.equal(p.speedSw, 1.06);
    assert.equal(p.gain, 1.38);
    assert.equal(p.fillerDelayMs, 320);
  });

  it('unknown profile name falls back to balanced', () => {
    assert.equal(resolveVoiceProfile(bareEnv({ VOICE_PROFILE: 'loud' })).name, 'balanced');
  });

  it('SONIOX_TTS_SPEED overrides both languages', () => {
    const p = resolveVoiceProfile(bareEnv({ SONIOX_TTS_SPEED: '1.1' }));
    assert.equal(p.speedEn, 1.1);
    assert.equal(p.speedSw, 1.1);
  });

  it('per-language speed env wins over the shared knob', () => {
    const env = bareEnv({
      SONIOX_TTS_SPEED: '1.1',
      SONIOX_TTS_SPEED_EN: '0.95',
      SONIOX_TTS_SPEED_SW: '0.9',
    });
    const p = resolveVoiceProfile(env);
    assert.equal(p.speedEn, 0.95);
    assert.equal(p.speedSw, 0.9);
    assert.equal(speedForLanguage('en', env), 0.95);
    assert.equal(speedForLanguage('sw', env), 0.9);
  });

  it('speedForLanguage reads the profile, not a module-load snapshot', () => {
    assert.equal(speedForLanguage('en', bareEnv()), 1);
    assert.equal(speedForLanguage('sw', bareEnv()), 1);
    assert.equal(speedForLanguage('en', bareEnv({ VOICE_PROFILE: 'snappy' })), 1.06);
  });

  it('clamps speed and gain', () => {
    const p = resolveVoiceProfile(
      bareEnv({ SONIOX_TTS_SPEED: '9', VOICE_TTS_GAIN: '0.1' })
    );
    assert.equal(p.speedEn, 1.3);
    assert.equal(p.gain, 0.5);
  });

  it('fillers stay in the call language; unknown is English', () => {
    assert.equal(fillerLanguage('en'), 'en');
    assert.equal(fillerLanguage('sw'), 'sw');
    assert.equal(fillerLanguage('sheng'), 'sw');
    assert.equal(fillerLanguage(''), 'en');
    assert.equal(fillerLanguage(null), 'en');
  });

  it('publicVoiceProfile is the healthz surface', () => {
    const p = publicVoiceProfile(bareEnv({ VOICE_PROFILE: 'snappy', VOICE_TTS_GAIN: '1.4' }));
    assert.deepEqual(p, {
      name: 'snappy',
      speedEn: 1.06,
      speedSw: 1.06,
      gain: 1.4,
      fillerDelayMs: 320,
    });
  });
});
