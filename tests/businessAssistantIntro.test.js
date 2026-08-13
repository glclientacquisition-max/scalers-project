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
    assert.match(line, /you've reached ChapterOne Bookstore/i);
    assert.match(line, /this is Aisha speaking/i);
    assert.match(line, /English or Kiswahili/i);
    assert.match(line, /How can I help/i);
    assert.doesNotMatch(line, /^\s*Habari/i);
    assert.ok(introLooksValid(line, 'ChapterOne Bookstore', 'Aisha'));
  });

  it('tells the caller they can use English or Kiswahili', () => {
    const { LANGUAGE_INVITE } = require('../src/conversation/businessAssistantIntro');
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.equal(LANGUAGE_INVITE, 'You can speak in English or Kiswahili.');
    assert.match(line, /You can speak in English or Kiswahili\./);
    assert.ok(line.indexOf('Aisha') < line.indexOf('English or Kiswahili'));
    assert.ok(line.indexOf('English or Kiswahili') < line.indexOf('How can I help'));
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
    assert.match(line, /you've reached ChapterOne Bookstore/i);
    assert.match(line, /We help with/i);
    assert.match(line, /delivery/i);
    assert.match(line, /How can I help/i);
    // Brand still leads — offering is not the first signal.
    assert.ok(line.indexOf('ChapterOne') < line.indexOf('We help with'));
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

  it('states closed honestly then still helps', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: false,
      afterHoursMode: 'serve',
      now: afternoon,
      variant: 0,
    });
    assert.match(line, /closed/i);
    assert.match(line, /still help/i);
    assert.match(line, /ChapterOne Bookstore/);
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
    assert.match(line, /you've reached ChapterOne Bookstore/i);
    assert.equal(greetingLooksValid(line, 'ChapterOne Bookstore', 'Aisha'), true);
    assert.equal(greetingLooksValid('Habari, this is Aisha', 'ChapterOne Bookstore', 'Aisha'), false);
  });

  it('rejects Habari-led first opens in validation', () => {
    assert.equal(
      introLooksValid(
        'Habari, you have reached ChapterOne Bookstore, this is Aisha speaking.',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      false
    );
  });
});
