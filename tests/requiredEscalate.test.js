const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureRequiredEscalate,
  formatEscalateActionDirective,
} = require('../src/conversation/requiredEscalate');

describe('required escalate injection', () => {
  it('injects escalate when NBA is ESCALATE and name is known', () => {
    const parsed = ensureRequiredEscalate(
      { spokenText: 'You can WhatsApp Harrison on 07…', escalate: null },
      {
        intent: 'human',
        handoff: { requested: true, reason: 'Caller requested manager' },
        resolution: { nextBestAction: 'ESCALATE' },
        caller: { name: 'Brian' },
        entities: {},
        goal: { missingSlots: [], description: 'speak to manager' },
      },
      { escalate: true }
    );
    assert.equal(parsed.escalate.name, 'Brian');
    assert.match(parsed.escalate.teammate, /manager/i);
    assert.ok(parsed.escalate.reason);
  });

  it('does not override an existing escalate marker', () => {
    const parsed = ensureRequiredEscalate(
      {
        escalate: {
          teammate: 'General queries',
          name: 'Kim',
          reason: 'wants owner',
        },
      },
      {
        resolution: { nextBestAction: 'ESCALATE' },
        caller: { name: 'Kim' },
      },
      { escalate: true }
    );
    assert.equal(parsed.escalate.teammate, 'General queries');
    assert.equal(parsed.escalate.reason, 'wants owner');
  });

  it('skips injection when name is still missing', () => {
    const parsed = ensureRequiredEscalate(
      { escalate: null },
      {
        resolution: { nextBestAction: 'ASK_CLARIFICATION' },
        intent: 'human',
        handoff: { requested: true },
        caller: { name: null },
        goal: { missingSlots: ['name'] },
      },
      { escalate: true }
    );
    assert.equal(parsed.escalate, null);
  });

  it('formats a hard turn directive when escalate is due', () => {
    const block = formatEscalateActionDirective({
      resolution: { nextBestAction: 'ESCALATE' },
      caller: { name: 'Brian' },
    });
    assert.match(block, /REQUIRED ACTION THIS TURN/i);
    assert.match(block, /Brian/);
    assert.match(block, /escalate/i);
  });

  it('formats ask-for-name directive when human handoff lacks a name', () => {
    const block = formatEscalateActionDirective({
      resolution: { nextBestAction: 'ASK_CLARIFICATION' },
      intent: 'human',
      handoff: { requested: true },
      caller: { name: null },
    });
    assert.match(block, /name is missing/i);
    assert.match(block, /Do NOT append escalate/i);
  });

  it('maps floor manager reason to Floor Manager teammate', () => {
    const parsed = ensureRequiredEscalate(
      { escalate: null },
      {
        resolution: { nextBestAction: 'ESCALATE' },
        caller: { name: 'Brian' },
        handoff: { reason: 'Caller wants Floor Manager' },
        goal: { description: 'speak to Floor Manager' },
      },
      { escalate: true }
    );
    assert.equal(parsed.escalate.teammate, 'Floor Manager');
  });
});
