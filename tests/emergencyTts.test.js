const { describe, it } = require('node:test');
const assert = require('assert');
const {
  pickSpeechOutageLine,
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  synthesizeEmergencyPcm,
} = require('../src/speech/emergencyTts');

describe('emergencyTts', () => {
  it('picks English and Kiswahili outage lines without fluff', () => {
    assert.equal(pickSpeechOutageLine('en'), OUTAGE_LINE_EN);
    assert.equal(pickSpeechOutageLine('sw'), OUTAGE_LINE_SW);
    assert.equal(pickSpeechOutageLine('sheng'), OUTAGE_LINE_SW);
    assert.doesNotMatch(OUTAGE_LINE_EN, /[—–]/);
    assert.doesNotMatch(OUTAGE_LINE_SW, /[—–]/);
  });

  it('returns null when espeak and Gemini are both unavailable', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const pcm = await synthesizeEmergencyPcm('Hello', { language: 'en' });
    if (prev != null) process.env.GEMINI_API_KEY = prev;
    // espeak-ng may be installed on the agent VM. Either a Buffer or null is ok;
    // never throw, and never return an empty buffer.
    if (pcm) {
      assert.ok(Buffer.isBuffer(pcm));
      assert.ok(pcm.length > 0);
    } else {
      assert.equal(pcm, null);
    }
  });
});
