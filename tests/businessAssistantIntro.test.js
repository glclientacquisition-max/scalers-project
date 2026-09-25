const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  composeBusinessAssistantIntro,
  previewBusinessAssistantIntro,
  introLooksValid,
  LANGUAGE_INVITE,
  isDefaultShopName,
} = require('../src/conversation/businessAssistantIntro');
const { fallbackGreeting, greetingLooksValid } = require('../src/conversation/dynamicSpeech');

const FORBIDDEN_OPEN = [
  /thank you for calling/i,
  /you've reached/i,
  /we help with/i,
  /^\s*Habari/i,
  /owner is away/i,
  /i am an ai/i,
  /virtual assistant/i,
  /intelligent agent/i,
  /press 1/i,
  /stay on the line/i,
  /You can speak in English or Kiswahili/i,
];

function assertForbiddenOpen(line) {
  for (const re of FORBIDDEN_OPEN) {
    assert.doesNotMatch(line, re, `forbidden on first open: ${re} in ${line}`);
  }
}

describe('business assistant introduction', () => {
  const afternoon = new Date('2026-08-13T10:00:00.000Z'); // 13:00 EAT
  const morning = new Date('2026-08-13T05:00:00.000Z'); // 08:00 EAT
  const evening = new Date('2026-08-13T17:00:00.000Z'); // 20:00 EAT

  it('leads with the shop then the agent and one question', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.equal(line, 'ChapterOne Bookstore, this is Aisha. How can I help?');
    assertForbiddenOpen(line);
    assert.ok(introLooksValid(line, 'ChapterOne Bookstore', 'Aisha'));
  });

  it('drops the English or Kiswahili invite from first audio', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.equal(LANGUAGE_INVITE, 'You can speak in English or Kiswahili.');
    assert.doesNotMatch(line, /You can speak in English or Kiswahili/i);
    assert.doesNotMatch(line, /english or kiswahili/i);
    assert.match(line, /How can I help/);
  });

  it('does not speak a catalog or We help with on first open', () => {
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
    assert.equal(line, 'ChapterOne Bookstore, this is Aisha. How can I help?');
    assert.doesNotMatch(line, /We help with/i);
    assert.doesNotMatch(line, /delivery/i);
    assertForbiddenOpen(line);
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
    assert.match(line, /How can I help/);
  });

  it('uses Good morning as a first-word swap only', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      isOpen: true,
      now: morning,
      variant: 0,
    });
    assert.equal(
      line,
      'Good morning, ChapterOne Bookstore, this is Aisha. How can I help?'
    );
    assert.doesNotMatch(line, /Good morning\./);
    assertForbiddenOpen(line);
  });

  it('uses Good evening as a first-word swap only', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'Done and Dusted',
      agentName: 'Shy',
      isOpen: true,
      now: evening,
      variant: 0,
    });
    assert.equal(line, 'Good evening, Done and Dusted, this is Shy. How can I help?');
    assertForbiddenOpen(line);
  });

  it('states closed honestly then asks the same question', () => {
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
    assert.equal(
      line,
      "ChapterOne Bookstore, this is Aisha. We're closed now. How can I help?"
    );
    assertForbiddenOpen(line);
    assert.ok(introLooksValid(line, 'ChapterOne Bookstore', 'Aisha'));
  });

  it('closed message mode asks for a name', () => {
    const line = composeBusinessAssistantIntro({
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
      servicesCatalog: [{ name: 'Delivery' }],
      isOpen: false,
      afterHoursMode: 'message',
      now: afternoon,
      variant: 0,
    });
    assert.equal(
      line,
      "ChapterOne Bookstore, this is Aisha. We're closed now. May I have your name?"
    );
    assert.doesNotMatch(line, /We help with/i);
    assertForbiddenOpen(line);
  });

  it('closed bulletin opener stays short then asks', () => {
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
    assert.match(line, /How can I help/);
    assert.doesNotMatch(line, /We help with/i);
    assertForbiddenOpen(line);
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
    assertForbiddenOpen(a);
  });

  it('fallbackGreeting wires through the intro composer', () => {
    const line = fallbackGreeting('ChapterOne Bookstore', {
      agentName: 'Aisha',
      isOpen: true,
      now: afternoon,
      variant: 0,
    });
    assert.equal(line, 'ChapterOne Bookstore, this is Aisha. How can I help?');
    assert.equal(greetingLooksValid(line, 'ChapterOne Bookstore', 'Aisha'), true);
    assert.equal(greetingLooksValid('Habari, this is Aisha', 'ChapterOne Bookstore', 'Aisha'), false);
  });

  it('rejects Habari, language invite, and AI disclose in validation', () => {
    assert.equal(
      introLooksValid(
        'Habari, you have reached ChapterOne Bookstore, this is Aisha at ChapterOne Bookstore.',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      false
    );
    assert.equal(
      introLooksValid(
        'ChapterOne Bookstore, this is Aisha. You can speak in English or Kiswahili. How can I help?',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      false
    );
    assert.equal(
      introLooksValid(
        'ChapterOne Bookstore, this is Aisha. I am an AI. How can I help?',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      false
    );
    assert.equal(
      introLooksValid(
        'ChapterOne Bookstore, this is Aisha. How can I help?',
        'ChapterOne Bookstore',
        'Aisha'
      ),
      true
    );
  });

  it('treats the business as a default shop name', () => {
    assert.equal(isDefaultShopName('the business'), true);
    assert.equal(isDefaultShopName('ChapterOne Bookstore'), false);
    assert.equal(isDefaultShopName(''), true);
  });
});
