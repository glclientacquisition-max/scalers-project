const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  attachCallerMemory,
  buildCallerMemoryCard,
  formatReturningCallerForPrompt,
  seedCallerFromMemory,
} = require('../src/conversation/callerMemory');
const { createBrainState, formatBrainStateForPrompt } = require('../src/conversation/brainState');
const { buildSystemPrompt } = require('../src/prompts');

describe('returning-caller card', () => {
  it('builds a named unique-line card from contact plus open work', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'held Atomic Habits for Saturday',
        notes: 'prefers afternoon',
        metadata: { alternate_names: [] },
      },
      openRequests: [
        { request_type: 'hold', item: 'Atomic Habits', when_text: 'Saturday' },
      ],
      nextAppointment: {
        service_name: 'geyser repair',
        when_text: 'tomorrow morning',
      },
    });
    assert.equal(card.greetByName, true);
    assert.equal(card.sharedLine, false);
    assert.equal(card.name, 'Jane');
    assert.match(card.lastReason, /Atomic Habits/);
    assert.equal(card.openRequests.length, 1);
    assert.match(card.nextAppointment, /geyser repair/);
  });

  it('treats alternate names as a shared line and will not greet by name', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'price on soap',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
    });
    assert.equal(card.sharedLine, true);
    assert.equal(card.greetByName, false);
    const block = formatReturningCallerForPrompt(card);
    assert.match(block, /RETURNING CALLER/);
    assert.match(block, /shared line/i);
    assert.doesNotMatch(block, /use this name/i);
  });

  it('strips transcript-like notes from the card', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000003',
        name: 'Jane',
        last_reason: 'Caller: hi\nAgent: hello',
        notes: 'Caller: I need soap\nAgent: sure',
        metadata: {},
      },
    });
    assert.equal(card.lastReason, null);
    assert.equal(card.notes, null);
    const block = formatReturningCallerForPrompt(card);
    assert.doesNotMatch(block, /Caller:/);
    assert.doesNotMatch(block, /Agent:/);
  });

  it('omits the prompt block when there is no card', () => {
    assert.equal(formatReturningCallerForPrompt(null), '');
    assert.equal(buildCallerMemoryCard({ contact: null }), null);
    const prompt = buildSystemPrompt({ businessName: 'Acme' });
    assert.doesNotMatch(prompt, /RETURNING CALLER/);
  });

  it('injects the card into CONTEXT HEADER and seeds Brain state on a unique line', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'held Atomic Habits for Saturday',
        metadata: {},
      },
    });
    const prompt = buildSystemPrompt({
      businessName: 'Chapter One',
      callerMemory: card,
    });
    assert.match(prompt, /RETURNING CALLER/);
    assert.match(prompt, /Jane/);
    assert.match(prompt, /Atomic Habits/);

    const state = createBrainState({ callerMemory: card });
    assert.equal(state.caller.name, 'Jane');
    assert.equal(state.caller.nameConfirmed, true);
    assert.equal(state.caller.phone, '+254700000001');
    assert.match(formatBrainStateForPrompt(state), /confirmed/i);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /Got it, Jane/);
  });

  it('does not seed a name on a shared line', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
    });
    const state = createBrainState({ callerMemory: card });
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    const seeded = seedCallerFromMemory({ name: null, nameConfirmed: false }, card);
    assert.equal(seeded.name, null);
    assert.equal(seeded.nameConfirmed, false);
  });

  it('attaches a card from call phone without throwing when lookup fails', async () => {
    const profile = { id: 'tenant-1' };
    await attachCallerMemory(profile, {
      callSid: 'CA1',
      getCall: async () => ({ tenant_id: 'tenant-1', from_number: '+254700000001' }),
      getCallerMemory: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(profile.callerMemory, undefined);

    const named = { id: 'tenant-1' };
    await attachCallerMemory(named, {
      callSid: 'CA2',
      getCall: async () => ({ tenant_id: 'tenant-1', from_number: '+254700000001' }),
      getCallerMemory: async () =>
        buildCallerMemoryCard({
          contact: { phone: '+254700000001', name: 'Jane', metadata: {} },
        }),
    });
    assert.equal(named.callerMemory.name, 'Jane');
  });
});
