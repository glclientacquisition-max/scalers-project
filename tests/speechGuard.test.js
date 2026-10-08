const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { guardSpokenReply, groundFilePriceLine } = require('../src/conversation/speechGuard');
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

  it('speaks the on-file carpet price for how much and pesa ngapi', () => {
    const profile = {
      afterHoursMode: 'serve',
      servicesCatalog: [{ name: 'Carpet cleaning', price_range: 'Ksh 1500-2000' }],
    };
    const prior = ['tell me more about carpet'];
    assert.equal(
      groundFilePriceLine({
        profile,
        text: 'How much is it?',
        callerTurns: [...prior, 'How much is it?'],
        language: 'en',
      }),
      'Carpet cleaning is Ksh 1500-2000.'
    );
    const denied = guardSpokenReply("I don't have that on file. I can note it for the team.", {
      ...serve,
      profile,
      callerTurns: [...prior, 'How much is it?'],
    });
    assert.equal(denied, 'Carpet cleaning is Ksh 1500-2000.');
    const sw = guardSpokenReply('Sina hiyo kwenye rekodi.', {
      ...serve,
      language: 'sw',
      profile,
      callerTurns: [...prior, 'Ni pesa ngapi?'],
    });
    assert.equal(sw, 'Carpet cleaning ni Ksh 1500-2000.');
    const hours = guardSpokenReply("I don't have that on file.", {
      ...serve,
      profile,
      callerTurns: [...prior, 'What time do you open?'],
    });
    assert.match(hours, /don't have that on file/);
  });

  it('keeps a spoken callback offer and drops a statement pitch', () => {
    const out = guardSpokenReply(
      `${catalogue} Would you like me to leave a message for the team about any of those services?`,
      {
        ...serve,
        callerTurns: ['List for me the services you offer.'],
      }
    );
    assert.match(out, /couches/);
    assert.match(out, /Would you like me to leave a message/);
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

describe('a price the reply already called not on file', () => {
  const FILE = {
    servicesCatalog: [{ name: '1-Bedroom Apartment (Standard)', price_range: 'KSh 3,000 flat' }],
  };
  const ASK_EN = ['How much is Airbnb cleaning?'];
  const ASK_SW = ['Bei ya Airbnb cleaning ni ngapi?'];

  it('turns a dropped number into the note offer once, in place', () => {
    const out = polishSpokenReply(
      "We don't have an Airbnb cleaning price on file. A 1-Bedroom Apartment standard clean is KSh 3,000 flat. Would you like that?",
      { profile: FILE, language: 'en', callerTurns: ASK_EN }
    );
    assert.equal(
      out,
      "We don't have an Airbnb cleaning price on file. I can note it for the team. Would you like that?"
    );
  });

  it('does not repeat not-on-file on a streamed piece after the reply said it', () => {
    const out = polishSpokenReply('Usafishaji wa 1-Bedroom Apartment ni KSh 3,000.', {
      profile: FILE,
      language: 'sw',
      callerTurns: ASK_SW,
      replyPartial: true,
      priorReply: 'Sina bei ya Airbnb cleaning kwa sasa.',
    });
    assert.equal(out, 'Naweza kuandika kwa timu.');
  });

  it('still leads with not-on-file when nothing said it', () => {
    const out = polishSpokenReply('A clean is KSh 9,999. Would you like that?', {
      profile: FILE,
      language: 'en',
      callerTurns: ASK_EN,
    });
    assert.match(out, /^I don't have that on file\. I can note it for the team\./);
  });
});
