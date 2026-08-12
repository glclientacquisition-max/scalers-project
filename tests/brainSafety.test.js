const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSystemPrompt,
  DEFAULT_KNOWLEDGE,
  CONVERSATION_RULES,
} = require('../src/prompts');
const { formatUnknownAnswerPolicy } = require('../src/conversation/liveKnowledge');
const {
  bulletinImpliesClosed,
  bulletinClosureNotice,
  formatBulletinForPrompt,
  bulletinKind,
} = require('../src/conversation/dailyBulletin');

describe('Brain production safety', () => {
  it('never falls back to demo tenant facts', () => {
    assert.doesNotMatch(DEFAULT_KNOWLEDGE, /Jirani|plumbing|Kiambu|M-Pesa/i);
    assert.match(DEFAULT_KNOWLEDGE, /No tenant-specific business knowledge/);

    const prompt = buildSystemPrompt({ businessName: 'Unconfigured Business' });
    assert.doesNotMatch(prompt, /Jirani|plumbing|Kiambu/i);
    assert.match(prompt, /No tenant-specific business knowledge/);
  });

  it('uses resolution-first rules without mandatory lead capture', () => {
    assert.match(CONVERSATION_RULES, /FULL ASSISTANCE/);
    assert.match(CONVERSATION_RULES, /Do not force lead capture/);
    const prompt = buildSystemPrompt({
      businessName: 'Test Shop',
      servicesCatalog: [{ name: 'Printing' }],
    });
    assert.match(prompt, /If fully answered, confirm briefly and close/);
    assert.match(prompt, /Never claim an action succeeded/);
  });

  it('does not turn unknown information into an automatic callback promise', () => {
    const policy = formatUnknownAnswerPolicy('');
    assert.match(policy, /unknown/i);
    assert.match(policy, /Do not force name\/reason capture/);
    assert.doesNotMatch(policy, /will follow up|will call|atakupigia/i);
  });

  it('does not classify an early-closing bulletin as closed all day', () => {
    const early = [
      {
        id: 'early',
        text: 'We are closing early at 2 PM today.',
        active: true,
      },
    ];
    assert.equal(bulletinImpliesClosed(early), false);
    assert.equal(bulletinClosureNotice(early), null);
  });

  it('still recognizes an explicit full-day closure', () => {
    const closed = [
      {
        id: 'closed',
        text: 'We are closed today.',
        active: true,
      },
    ];
    assert.equal(bulletinImpliesClosed(closed), true);
    assert.equal(bulletinClosureNotice(closed), 'We are closed today.');
  });

  it('classifies promo bulletins and forbids volunteering them off-topic', () => {
    assert.equal(
      bulletinKind('White Paper Books go for 3 Books at KSH 1000'),
      'promo'
    );
    assert.equal(bulletinKind('We are closed today.'), 'operational');
    const block = formatBulletinForPrompt([
      {
        id: 'promo',
        text: 'Notify Customers: White Paper Books go for 3 Books at KSH 1000',
        active: true,
      },
    ]);
    assert.match(block, /\[promo\]/);
    assert.match(block, /NEVER volunteer a promo/i);
  });
});
