// HD_d199dbbf6b79 (staging, 2026-10-09 11:41 EAT): the Kiswahili visit
// confirmation spoke 09:00 as "saa 9 asubuhi" twice, after the caller had
// corrected it ("Saa 3 asubuhi, si saa 9 asubuhi"). The Swahili clock is the
// 24-hour clock minus 6: 09:00 is "saa tatu asubuhi".
// Everything here is behind VOICE_SPOKEN_FACTS=on; flag off keeps today's
// wording (see the "flag off" block and tests/ttsNormalize.test.js).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  swahiliClock,
  normalizeSwahiliClockText,
  reconcileSwahiliTimes,
  readSwahiliClock,
} = require('../src/conversation/swahiliClock');
const { evaluateAppointmentHours, formatRequestedWhenLabel } = require('../src/conversation/appointmentHours');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const storedClock = require('../src/speech/storedClock');

const at = (h, m = 0) => h * 60 + m;
const NOW = new Date('2026-10-09T08:43:00Z'); // Friday 11:43 EAT
const SAT_9 = evaluateAppointmentHours({ whenText: 'Saturday 10 October 2026, 9 AM', schedule: null, now: NOW });

function withFlag(value) {
  let saved;
  before(() => {
    saved = process.env.VOICE_SPOKEN_FACTS;
    if (value == null) delete process.env.VOICE_SPOKEN_FACTS;
    else process.env.VOICE_SPOKEN_FACTS = value;
  });
  after(() => {
    if (saved == null) delete process.env.VOICE_SPOKEN_FACTS;
    else process.env.VOICE_SPOKEN_FACTS = saved;
  });
}

describe('flag off: today\'s behaviour', () => {
  withFlag(null);
  it('confirmation and TTS keep the numeral form', () => {
    assert.equal(
      formatToolConfirmation([{ action: 'create_appointment', status: 'succeeded', hours: SAT_9 }], 'sw'),
      'Sawa, nimehifadhi ombi la ziara Jumamosi, 9 AM.'
    );
    assert.match(prepareForTts('Nimehifadhi ombi la ziara Jumamosi, 9 AM.', { callLanguage: 'sw', language: 'sw' }).text, /saa 9 asubuhi/);
    const out = prepareForTts('Ziara ni saa nne asubuhi.', { callLanguage: 'sw', language: 'sw', spokenFacts: { times: [at(9)] } });
    assert.equal(out.factMismatches, undefined);
  });
});

describe('swahiliClock: hour minus 6, with period and minutes', () => {
  it('hours', () => {
    assert.equal(swahiliClock(at(9)), 'saa tatu asubuhi');
    assert.equal(swahiliClock(at(6)), 'saa kumi na mbili asubuhi');
    assert.equal(swahiliClock(at(7)), 'saa moja asubuhi');
    assert.equal(swahiliClock(at(12)), 'saa sita mchana');
    assert.equal(swahiliClock(at(15)), 'saa tisa mchana');
    assert.equal(swahiliClock(at(16)), 'saa kumi jioni');
    assert.equal(swahiliClock(at(19)), 'saa moja jioni');
    assert.equal(swahiliClock(at(21)), 'saa tatu usiku');
    assert.equal(swahiliClock(at(0)), 'saa sita usiku');
  });
  it('na nusu, na robo, kasoro robo, dakika', () => {
    assert.equal(swahiliClock(at(9, 30)), 'saa tatu na nusu asubuhi');
    assert.equal(swahiliClock(at(9, 15)), 'saa tatu na robo asubuhi');
    assert.equal(swahiliClock(at(9, 45)), 'saa nne kasoro robo asubuhi');
    assert.equal(swahiliClock(at(11, 45)), 'saa sita kasoro robo asubuhi');
    assert.equal(swahiliClock(at(9, 10)), 'saa tatu na dakika kumi asubuhi');
    assert.equal(swahiliClock(at(9, 50)), 'saa nne kasoro dakika kumi asubuhi');
    assert.equal(swahiliClock(at(14, 25)), 'saa nane na dakika ishirini na tano mchana');
  });
  it('reads a Swahili phrase, Western slip only when the period rules out Swahili', () => {
    assert.deepEqual(readSwahiliClock('3', 0, 'asubuhi'), { minutes: [at(9)], western: false });
    assert.deepEqual(readSwahiliClock('tatu', 0, 'asubuhi'), { minutes: [at(9)], western: false });
    assert.deepEqual(readSwahiliClock('9', 0, 'asubuhi'), { minutes: [at(9)], western: true });
    assert.deepEqual(readSwahiliClock('tisa', 0, 'mchana'), { minutes: [at(15)], western: false });
  });
});

describe('every Kiswahili time line uses the clock', () => {
  withFlag('on');
  it('visit confirmation and move line (HD_d199dbbf6b79 t12, t16)', () => {
    assert.equal(formatRequestedWhenLabel(SAT_9.resolved ? SAT_9 : null, 'sw'), 'Jumamosi, saa tatu asubuhi');
    assert.equal(
      formatToolConfirmation([{ action: 'create_appointment', status: 'succeeded', hours: SAT_9 }], 'sw'),
      'Sawa, nimehifadhi ombi la ziara Jumamosi, saa tatu asubuhi.'
    );
    assert.equal(
      formatToolConfirmation([{ action: 'update_appointment', status: 'succeeded', hours: SAT_9 }], 'sw'),
      'Sawa, nimehamisha ziara Jumamosi, saa tatu asubuhi.'
    );
    // Tool results carry the rendered phrase; the confirmation copies it.
    const { spokenWhenFor } = require('../src/conversation/toolExecution');
    const spoken = spokenWhenFor(SAT_9, NOW);
    assert.deepEqual(spoken, { en: 'tomorrow, Saturday, at 9 AM', sw: 'kesho Jumamosi, saa tatu asubuhi', sheng: 'kesho Saturday, 9 AM' });
    assert.equal(
      formatToolConfirmation([{ action: 'create_appointment', status: 'succeeded', hours: SAT_9, spokenWhen: spoken }], 'sw'),
      'Sawa, nimehifadhi ombi la ziara kesho Jumamosi, saa tatu asubuhi.'
    );
    assert.equal(
      formatToolConfirmation([{ action: 'update_appointment', status: 'succeeded', hours: SAT_9, spokenWhen: spoken }], 'en'),
      "Okay, I've moved that visit to tomorrow, Saturday, at 9 AM."
    );
  });

  it('TTS: the exact staged lines speak saa tatu asubuhi', () => {
    for (const line of ['Nimehifadhi ombi la ziara Jumamosi, 9 AM.', 'Nimehamisha ziara Jumamosi, 9 AM.']) {
      const out = prepareForTts(line, { callLanguage: 'sw', language: 'sw' }).text;
      assert.match(out, /Jumamosi, saa tatu asubuhi\./, out);
      assert.doesNotMatch(out, /saa 9|saa tisa/, out);
    }
  });

  it('TTS: a model-written "saa 9 asubuhi" is rewritten, a correct Swahili time stays', () => {
    assert.equal(normalizeSwahiliClockText('Ziara ni Jumamosi saa 9 asubuhi.'), 'Ziara ni Jumamosi saa tatu asubuhi.');
    assert.equal(normalizeSwahiliClockText('Tufike saa 3 asubuhi.'), 'Tufike saa tatu asubuhi.');
    assert.equal(normalizeSwahiliClockText('saa tisa mchana'), 'saa tisa mchana');
    assert.equal(normalizeSwahiliClockText('saa moja jioni'), 'saa moja jioni');
    assert.equal(prepareForTts('Tunafungua 8am - 6pm.', { callLanguage: 'sw', language: 'sw' }).text, 'Tunafungua saa mbili asubuhi hadi saa kumi na mbili jioni.');
    assert.equal(prepareForTts('Saa 14:30 sawa.', { callLanguage: 'sw', language: 'sw' }).text, 'Saa nane na nusu mchana sawa.');
  });
});

describe('guard: a Kiswahili time is checked against the stored visit time', () => {
  withFlag('on');
  it('rewrites a slip that names the stored time; flags one that names another time', () => {
    assert.equal(reconcileSwahiliTimes('Jumamosi saa 9 asubuhi.', [at(9)]).text, 'Jumamosi saa tatu asubuhi.');
    const wrong = reconcileSwahiliTimes('Jumamosi saa nne asubuhi.', [at(9)]);
    assert.equal(wrong.text, 'Jumamosi saa nne asubuhi.');
    assert.deepEqual(wrong.mismatches, [{ said: 'saa nne asubuhi', stored: [at(9)] }]);
    // A correct afternoon time is never bent to a stored 09:00.
    assert.equal(reconcileSwahiliTimes('saa tisa mchana', [at(9)]).mismatches.length, 1);
  });

  it('prepareForTts takes the call stored times and reports a mismatch', () => {
    const ok = prepareForTts('Nimehamisha ziara Jumamosi, saa 9 asubuhi.', { callLanguage: 'sw', language: 'sw', spokenFacts: () => ({ times: [at(9)] }) });
    assert.equal(ok.text, 'Nimehamisha ziara Jumamosi, saa tatu asubuhi.');
    assert.equal(ok.factMismatches, undefined);
    // No time written on this call: a different visit time is reported, not guessed.
    const bad = prepareForTts('Ziara ni saa nne asubuhi.', { callLanguage: 'sw', language: 'sw', spokenFacts: { times: [at(9)] } });
    assert.equal(bad.factMismatches.length, 1);
    // A time written on this call replaces a wrong visit time.
    const fixed = prepareForTts('Nimehamisha ziara Jumamosi, saa nne asubuhi.', { callLanguage: 'sw', language: 'sw', spokenFacts: { times: [at(9)], latestTime: at(9) } });
    assert.equal(fixed.text, 'Nimehamisha ziara Jumamosi, saa tatu asubuhi.');
    const en = prepareForTts("I've saved your visit for Saturday at 10 AM.", { callLanguage: 'en', language: 'en', spokenFacts: { times: [at(9)], latestTime: at(9) } });
    assert.match(en.text, /9 A M/);
    // An amount that is not a stored price is reported.
    const price = prepareForTts('Interior window cleaning is KSh 250 per window.', { callLanguage: 'en', language: 'en', spokenFacts: { times: [], amounts: [200] } });
    assert.deepEqual(price.factMismatches.map((m) => m.kind), ['amount']);
    assert.equal(prepareForTts('It is KSh 200 per window.', { callLanguage: 'en', language: 'en', spokenFacts: { amounts: [200] } }).factMismatches, undefined);
  });

  it('storedClock collects appointment writes per call', () => {
    storedClock.clearStoredClocks('HD_test');
    storedClock.noteStoredToolResults('HD_test', [
      { action: 'create_appointment', status: 'succeeded', hours: SAT_9 },
      { action: 'save_caller_info', status: 'succeeded' },
    ]);
    storedClock.noteStoredAppointments('HD_test', [{ window_start: '2026-10-09T06:00:29.205Z' }]);
    assert.deepEqual(storedClock.storedClockMinutes('HD_test').sort(), [at(9)]);
    storedClock.clearStoredClocks('HD_test');
    assert.deepEqual(storedClock.storedClockMinutes('HD_test'), []);
  });
});

describe('prompt time example (src/prompts.js)', () => {
  const { buildSystemPrompt, CONVERSATION_RULES, conversationRules } = require('../src/prompts');
  it('flag off: unchanged', () => {
    assert.equal(conversationRules({}), CONVERSATION_RULES);
    assert.match(CONVERSATION_RULES, /"saa 3 jioni"/);
  });
  it('flag on: 3 PM is "saa tisa mchana", from swahiliClock', () => {
    const on = conversationRules({ VOICE_SPOKEN_FACTS: 'on' });
    assert.match(on, /\("3 P M" \/ "saa tisa mchana"\)/);
    assert.doesNotMatch(on, /saa 3 jioni/);
  });
  describe('buildSystemPrompt follows the flag', () => {
    withFlag('on');
    it('uses the Kiswahili clock example', () => {
      const prompt = buildSystemPrompt({ businessName: 'Test' });
      assert.match(prompt, /saa tisa mchana/);
      assert.doesNotMatch(prompt, /saa 3 jioni/);
    });
  });
});
