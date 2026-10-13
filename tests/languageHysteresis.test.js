delete process.env.FACT_HASH_MODE;
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  langHysteresisEnabled,
  createLanguageLock,
  observeTurn,
  scoreTurnLanguage,
  lockReplyLanguage,
  isLoanwordOnly,
  detectExplicitRequest,
  sentenceTtsLanguage,
  splitGreetingSentences,
  lockToCallLanguage,
} = require('../src/conversation/languageHysteresis');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const PREV = process.env.VOICE_LANG_HYSTERESIS;

afterEach(() => {
  if (PREV == null) delete process.env.VOICE_LANG_HYSTERESIS;
  else process.env.VOICE_LANG_HYSTERESIS = PREV;
});

describe('langHysteresisEnabled', () => {
  it('defaults off', () => {
    assert.equal(langHysteresisEnabled({}), false);
    assert.equal(langHysteresisEnabled({ VOICE_LANG_HYSTERESIS: 'on' }), true);
  });
});

describe('scoreTurnLanguage + loanwords', () => {
  it('marks loanword-only turns as mixed', () => {
    assert.equal(isLoanwordOnly('cleaning services'), true);
    const scored = scoreTurnLanguage('cleaning price');
    assert.equal(scored.turnLang, 'mixed');
  });
});

describe('hysteresis 2 of 3 (does not flip on a single blip)', () => {
  it('stays sw on one English blip; switches after 2 of 3', () => {
    let lock = createLanguageLock({ lang: 'sw' });
    let r = observeTurn(lock, { text: 'Nataka cleaning kesho Rongai' });
    lock = r.lock;
    assert.equal(lock.lang, 'sw');

    r = observeTurn(lock, { text: 'Can we do tomorrow morning please' });
    lock = r.lock;
    assert.equal(lock.lang, 'sw', 'single clear en turn must not flip');

    r = observeTurn(lock, { text: 'What time do you open on Saturday' });
    lock = r.lock;
    assert.equal(lock.lang, 'en', '2 of 3 en turns switch');
    assert.equal(r.decision.switched, true);
  });

  it('pins on explicit request', () => {
    let lock = createLanguageLock({ lang: 'en' });
    assert.equal(detectExplicitRequest('Tafadhali ongea Kiswahili'), 'sw');
    const r = observeTurn(lock, { text: 'Tafadhali ongea Kiswahili' });
    assert.equal(r.lock.lang, 'sw');
    assert.equal(r.lock.pinned, true);
    const hold = observeTurn(r.lock, { text: 'What time do you close today please' });
    assert.equal(hold.lock.lang, 'sw', 'pin holds against English');
  });
});

describe('lockReplyLanguage (#614 consumer shape)', () => {
  it('returns { lang, source } and respects loanword sticky', () => {
    const hit = lockReplyLanguage({
      text: 'cleaning',
      state: { lang: 'sw' },
    });
    assert.equal(hit.lang, 'sw');
    assert.equal(hit.source, 'sticky_loanword_turn');
  });
});

describe('greeting sentence split', () => {
  it('splits en opener from sw invite', () => {
    const parts = splitGreetingSentences(
      'Good morning, Esga, this is Lucy. Nikusaidie vipi.'
    );
    assert.equal(parts.length, 2);
    assert.equal(sentenceTtsLanguage(parts[0]), 'en');
    assert.equal(sentenceTtsLanguage(parts[1]), 'sw');
  });
});

describe('server wiring flag-gated', () => {
  it('keeps resolveLanguageState on the off path', () => {
    assert.ok(SERVER.includes('langHysteresisEnabled'));
    assert.ok(SERVER.includes('VOICE_LANG_HYSTERESIS') || SERVER.includes('langHysteresisEnabled'));
    assert.ok(SERVER.includes('resolveLanguageState(callLanguageState, languageEvidence)'));
    // v2: the greeting is one synthesis call — no per-sentence split.
    assert.ok(!SERVER.includes('greeting sentence tts lang='));
    assert.ok(!SERVER.includes('splitGreetingSentences('));
    assert.equal(lockToCallLanguage({ lang: 'sw' }), 'sw');
  });
});

describe('v2 bug 5: mixed turns never count, two clear turns to switch', () => {
  const on = () => { process.env.VOICE_LANG_HYSTERESIS = 'on'; };
  it('code-switched turns stay mixed and never flip the lock', () => {
    on();
    let lock = createLanguageLock({ lang: 'en' });
    for (const t of [
      'Nataka cleaning ya carpet tomorrow morning kama inawezekana',
      'I want the mattress cleaning lakini kesho asubuhi',
      'Yes please, ningependa kujua bei ya sofa cleaning',
    ]) {
      const r = observeTurn(lock, { text: t });
      lock = r.lock;
      assert.equal(r.decision.switched, false, t);
      assert.equal(lock.lang, 'en', t);
    }
  });
  it('one clear Swahili turn does not switch; two in a row do; a mixed turn resets', () => {
    on();
    let lock = createLanguageLock({ lang: 'en' });
    const sw = 'Habari yako, ningependa kuuliza kuhusu huduma zenu za usafi wa nyumba';
    lock = observeTurn(lock, { text: sw }).lock;
    assert.equal(lock.lang, 'en');
    lock = observeTurn(lock, { text: 'I want the mattress cleaning lakini kesho asubuhi' }).lock;
    lock = observeTurn(lock, { text: sw }).lock;
    assert.equal(lock.lang, 'en');
    lock = observeTurn(lock, { text: 'Naomba mtu aje kesho asubuhi kusafisha nyumba yangu' }).lock;
    assert.equal(lock.lang, 'sw');
  });
});
