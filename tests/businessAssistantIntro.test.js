const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  composeBusinessAssistantIntro,
  previewBusinessAssistantIntro,
  introLooksValid,
} = require('../src/conversation/businessAssistantIntro');
const { fallbackGreeting, greetingLooksValid } = require('../src/conversation/dynamicSpeech');

describe('business assistant introduction', () => {
  const afternoon = new Date('2026-08-13T10:00:00.000Z'); // 13:00 EAT
  const morning = new Date('2026-08-13T05:00:00.000Z'); // 08:00 EAT

  it('leads with the business brand and agent name in English', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /this is Aisha at ChapterOne Bookstore/i);
    assert.match(line, /How can I help you/i);
    assert.doesNotMatch(line, /you've reached/i);
    assert.doesNotMatch(line, /English or Kiswahili/i);
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /^\s*Habari/i);
    assert.ok(introLooksValid(line, 'ChapterOne Bookstore', 'Aisha'));
  });

  it('keeps the language invite constant but does not speak it on first open', () => {
    const { LANGUAGE_INVITE } = require('../src/conversation/businessAssistantIntro');
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.equal(LANGUAGE_INVITE, 'You can speak in English or Kiswahili.');
    assert.doesNotMatch(line, /You can speak in English or Kiswahili\./);
    assert.match(line, /How can I help/);
  });

  it('adds a short grounded offering from the services catalog', () => {
    const {
      summarizeOfferingForIntro,
    } = require('../src/conversation/businessAssistantIntro');
    const offering = summarizeOfferingForIntro({
      servicesCatalog: [
        { name: 'Special orders / sourcing' },
        { name: 'Delivery' },
        { name: 'In-store sales' },
      ],
    });
    assert.match(offering, /We help with/i);
    assert.match(offering, /special orders/i);

    const filtered = summarizeOfferingForIntro({
      servicesCatalog: [
        { name: 'What they offer (confirmed):' },
        { name: 'Products & Pricing' },
        { name: 'Stationery, toners, printers' },
        { name: 'When asked "how much for X?"' },
      ],
    });
    assert.match(filtered, /stationery/i);
    assert.doesNotMatch(filtered, /confirmed|when asked|products & pricing/i);

    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [
        { name: 'Special orders / sourcing' },
        { name: 'Delivery' },
      ],
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /this is Aisha at ChapterOne Bookstore/i);
    assert.match(line, /How can I help/i);
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /English or Kiswahili/i);
    assert.doesNotMatch(line, /delivery/i);
  });

  it('does not invent an offering when none is on file', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [],
      servicesOffered: '',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.doesNotMatch(line, /We help with/i);
    assert.match(line, /How can I help/i);
  });

  it('uses Good morning for EAT morning', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: morning,
      variant: 0,
    });
    assert.match(line, /^Good morning,/);
  });

  it('states closed honestly then still helps without services or language invite', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [
        { name: 'Special orders / sourcing' },
        { name: 'Delivery' },
      ],
      isOpen: false,
      afterHoursMode: 'serve',
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /this is Aisha at ChapterOne Bookstore/i);
    assert.match(line, /this is Aisha at ChapterOne Bookstore/i);
    assert.match(line, /closed/i);
    assert.match(line, /still help/i);
    assert.match(line, /How can I help you/i);
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /English or Kiswahili/i);
    assert.ok(introLooksValid(line, 'ChapterOne Bookstore', 'Aisha'));
  });

  it('closed message mode asks for a name without the open-hours catalog', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [{ name: 'Delivery' }],
      isOpen: false,
      afterHoursMode: 'message',
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /take a message/i);
    assert.match(line, /May I have your name/i);
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /English or Kiswahili/i);
  });

  it('closed bulletin opener stays short', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [{ name: 'Delivery' }],
      isOpen: true,
      closureNotice: 'We are closed for inventory today.',
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /closed for inventory/i);
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /English or Kiswahili/i);
  });

  it('preview is deterministic for Desk Test', () => {
    const a = previewBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
    });
    const b = previewBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
    });
    assert.equal(a, b);
    assert.match(a, /ChapterOne Bookstore/);
    assert.match(a, /Aisha/);
  });

  it('fallbackGreeting wires through the intro composer', () => {
    const line = fallbackGreeting('ChapterOne Bookstore', {
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /this is Aisha at ChapterOne Bookstore/i);
    assert.equal(greetingLooksValid(line, 'ChapterOne Bookstore', 'Aisha'), true);
    assert.equal(greetingLooksValid('Habari, this is Aisha', 'ChapterOne Bookstore', 'Aisha'), false);
  });

  it('rejects Habari-led first opens in validation', () => {
    assert.equal(
      introLooksValid(
        'Habari, you have reached ChapterOne Bookstore, this is Aisha at ChapterOne Bookstore.',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      false
    );
  });
});
