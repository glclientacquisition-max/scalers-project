// Spoken-reply pipeline: ordered stages, drop records, keep real answers.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runSpokenReplyPipeline, MAX_DROP_FRACTION } = require('../src/speech/spokenReplyPipeline');

const SERVICES =
  'Huduma zetu ni usafi wa nyumba, usafi wa ofisi, fumigation, na carpet cleaning. Bei inaanzia elfu tano. Ungependa tukuhudumie na gani?';

function ctx(caller, extra = {}) {
  return {
    callerTurns: [caller],
    state: { conversation: { answersReceived: [caller] } },
    profile: { businessName: 'Chapter One' },
    language: 'sw',
    toolResults: [],
    capabilities: {},
    ...extra,
  };
}

describe('spoken reply pipeline', () => {
  it('keeps a Kiswahili services list that used to shrink to the last question', () => {
    const drops = [];
    const spoken = runSpokenReplyPipeline(SERVICES, {
      ...ctx('Ni services gani mna offer?'),
      log(drop) {
        drops.push(drop);
      },
    });
    assert.match(spoken.text, /usafi wa nyumba/i);
    assert.match(spoken.text, /fumigation/i);
    assert.match(spoken.text, /carpet cleaning/i);
    assert.match(spoken.text, /Ungependa tukuhudumie na gani/i);
    assert.notEqual(spoken.text, 'Ungependa tukuhudumie na gani?');
    assert.ok(spoken.text.length / SERVICES.length >= 0.5);
    assert.ok(drops.some((drop) => drop.stage && drop.reason));
    assert.ok(MAX_DROP_FRACTION > 0 && MAX_DROP_FRACTION < 1);
  });

  it('keeps an English catalogue instead of replacing it with a canned dump', () => {
    const spoken = runSpokenReplyPipeline(
      'We clean carpets, couches, and mattresses. Prices start at five thousand.',
      ctx('What services do you offer?', { language: 'en' })
    );
    assert.match(spoken.text, /carpets/i);
    assert.match(spoken.text, /couches/i);
    assert.match(spoken.text, /mattresses/i);
  });

  it('still replaces an invented price that is not on file', () => {
    const spoken = runSpokenReplyPipeline('It costs 500 shillings.', {
      callerTurns: ['How much is sofa cleaning?'],
      state: { conversation: { answersReceived: ['How much is sofa cleaning?'] } },
      profile: { businessName: 'Chapter One', servicesCatalog: [] },
      language: 'en',
      toolResults: [],
      capabilities: {},
    });
    assert.doesNotMatch(spoken.text, /500/);
    assert.match(spoken.text, /don't have that on file/i);
  });

  it('drops a send narration and marks it so the turn does not ask again', () => {
    const spoken = runSpokenReplyPipeline("I've sent that to the team.", ctx('Please tell Alvin.', { language: 'en' }));
    assert.equal(spoken.text, '');
    assert.equal(spoken.hidNarration, true);
  });

  it('still strips a hedge and an unsaved booking claim', () => {
    const hedge = runSpokenReplyPipeline('Okay, one moment. We are open until 6 PM.', { language: 'en' });
    assert.equal(hedge.text, 'We are open until 6 PM.');
    const booked = runSpokenReplyPipeline("Okay, I've booked you for Thursday. Stay on the line.", { language: 'en' });
    assert.doesNotMatch(booked.text, /booked|stay on the line/i);
  });

  it('logs a kept list without emptying the reply', () => {
    const drops = [];
    const spoken = runSpokenReplyPipeline(
      "I'm doing well, thank you! We specialize in couch, carpet, and mattress cleaning.",
      {
        callerTurns: ['Mm-hm.'],
        state: { conversation: { answersReceived: ['Mm-hm.'] } },
        profile: {},
        language: 'en',
        log(drop) {
          drops.push(drop);
        },
      }
    );
    assert.match(spoken.text, /couch/i);
    assert.match(spoken.text, /carpet/i);
    assert.match(spoken.text, /mattress/i);
    assert.ok(drops.some((drop) => drop.stage === 'service_dump' && drop.kept === true));
  });
});
