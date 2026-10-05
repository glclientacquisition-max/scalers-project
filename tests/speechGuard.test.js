const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');

const serve = {
  profile: { afterHoursMode: 'serve' },
  state: { messageOnly: false },
  language: 'en',
  allowEmpty: true,
};

const catalogue =
  'We clean couches, mattresses, carpets, houses, Airbnbs, and pet stains.';

describe('speech slop gate', () => {
  it('drops help filler when the caller asked which services', () => {
    const out = guardSpokenReply('We can help with that. What do you need done?', {
      ...serve,
      callerTurns: ['Which services do you offer?'],
    });
    assert.equal(out, '');
    const singular = guardSpokenReply('We can help with that. What do you need done?', {
      ...serve,
      callerTurns: ['Which service do you offer?'],
    });
    assert.equal(singular, '');
  });

  it('keeps a catalogue sentence that follows the filler', () => {
    const spoken = `We can help with that. What do you need done? ${catalogue}`;
    const out = guardSpokenReply(spoken, {
      ...serve,
      callerTurns: ['Which services do you offer?'],
    });
    assert.equal(out, catalogue);
    const throughMouth = polishSpokenReply(spoken, {
      ...serve,
      callerTurns: ['Which services do you offer?'],
    });
    assert.equal(throughMouth, catalogue);
  });

  it('keeps a real price and drops the note-it filler on a price ask', () => {
    const out = guardSpokenReply(
      'How can we help you today? I can note it down for the team. Carpet cleaning costs 1500 to 2000 shillings.',
      {
        ...serve,
        callerTurns: ['How much is carpet cleaning?'],
        profile: {
          afterHoursMode: 'serve',
          servicesCatalog: [{ name: 'Carpet cleaning', price_range: '1500 to 2000' }],
        },
      }
    );
    assert.equal(out, 'Carpet cleaning costs 1500 to 2000 shillings.');
  });

  it('drops an unasked callback pitch after a catalogue', () => {
    const out = guardSpokenReply(
      `${catalogue} Would you like me to leave a message for the team about any of those services?`,
      {
        ...serve,
        callerTurns: ['List for me the services you offer.'],
      }
    );
    assert.equal(out, catalogue);
    const callYou = guardSpokenReply(
      `${catalogue} I can leave a message for the team to call you.`,
      {
        ...serve,
        callerTurns: ['Oh, nice.'],
      }
    );
    assert.equal(callYou, catalogue);
  });

  it('keeps the message-only booking line when they asked to book', () => {
    const line = "I'll take a message and have the team call you.";
    const out = guardSpokenReply(line, {
      callerTurns: ['I want to book a carpet clean.'],
      profile: { afterHoursMode: 'message' },
      state: { messageOnly: true },
      capabilities: { messageOnly: true },
      language: 'en',
    });
    assert.equal(out, line);
  });

  it('keeps a name confirm', () => {
    const out = guardSpokenReply('Am I speaking with Alvin?', {
      ...serve,
      callerTurns: ['I think you have my name on file.'],
    });
    assert.equal(out, 'Am I speaking with Alvin?');
  });

  it('still asks how it can help when the caller has not asked a specific question', () => {
    assert.equal(
      guardSpokenReply('How can we help you today?', {
        ...serve,
        callerTurns: ['Hello.'],
      }),
      'How can we help you today?'
    );
    assert.equal(
      guardSpokenReply('We can help with that.', {
        ...serve,
        callerTurns: ['Hello.'],
      }),
      ''
    );
  });
});
