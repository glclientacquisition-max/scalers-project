// HD_23445a4f780c: "Okay" to "Should I note it for the team?" saved a callback
// whose note was that same question, then spoke "Okay, I've saved your request."
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const {
  validateServiceRequest,
  formatToolConfirmation,
  toolOutcomeLine,
  executeBrainTools,
} = require('../src/conversation/toolExecution');
const { isEmptyRequestContent } = require('../src/conversation/requestNoteContent');

const offer = { kind: 'offer', act: 'note_team', line: 'Should I note it for the team?' };

describe('no saved line without a real request', () => {
  it('the agent offer, closers and acks are not request content', () => {
    for (const notes of [
      'Should I note it for the team?',
      'Naweza kukuachia ujumbe kwa timu yetu?',
      'Is there anything else I can help you with today?',
      'Okay.',
      'Sawa',
      '',
    ]) {
      assert.equal(isEmptyRequestContent({ item: 'message', notes }), true, notes);
    }
    assert.equal(isEmptyRequestContent({ item: '', notes: 'Do you cover Nakuru?' }), false);
    assert.equal(isEmptyRequestContent({ item: 'carpet cleaning', notes: '' }), false);
  });

  it('an enquiry or callback that echoes the agent question is invalid, no row', () => {
    for (const type of ['enquiry', 'callback', 'other']) {
      const v = validateServiceRequest({ type, item: '', notes: 'Should I note it for the team?' });
      assert.equal(v.valid, false, type);
      assert.equal(v.code, 'empty_note', type);
    }
    assert.equal(
      validateServiceRequest({ type: 'enquiry', item: '', notes: 'Caller asked: do you clean offices in Juja?' }).valid,
      true
    );
  });

  it('an empty-note result speaks nothing, never "saved"', () => {
    const rows = [{ action: 'create_service_request', status: 'invalid', code: 'empty_note' }];
    assert.equal(formatToolConfirmation(rows, 'en'), '');
    assert.equal(toolOutcomeLine(rows, 'en'), '');
    assert.equal(toolOutcomeLine(rows, 'sw'), '');
  });

  it('a yes to the offer with no caller ask creates no hold', () => {
    const out = ensureRequiredCreateRequest(
      {},
      {
        caller: { name: null },
        conversation: {
          consentAck: true,
          pendingAsk: offer,
          questionsAsked: ['offer'],
          answersReceived: ['Okay.'],
        },
      },
      {}
    );
    assert.equal(out.serviceRequest, undefined);
  });

  it('a yes to the offer after a real ask saves the caller words', () => {
    const out = ensureRequiredCreateRequest(
      {},
      {
        caller: { name: 'Alvin' },
        conversation: {
          consentAck: true,
          pendingAsk: offer,
          questionsAsked: ['offer'],
          answersReceived: ['Maybe Nakuru, Kisumu, how is it done?', 'Okay.'],
        },
      },
      {}
    );
    assert.equal(out.serviceRequest.type, 'callback');
    assert.match(out.serviceRequest.notes, /Nakuru, Kisumu/);
    assert.doesNotMatch(out.serviceRequest.notes, /note it for the team/i);
  });

  it('executeBrainTools writes no row for a model enquiry with only the offer as notes', async () => {
    let writes = 0;
    const { results } = await executeBrainTools({
      parsed: { serviceRequest: { type: 'enquiry', item: '', notes: 'Should I note it for the team?' } },
      capabilities: { createServiceRequest: true },
      handlers: {
        createServiceRequest: async () => {
          writes += 1;
          return { id: 'x' };
        },
      },
    }).then((r) => (Array.isArray(r) ? { results: r } : r));
    assert.equal(writes, 0);
    assert.ok(results.some((r) => r.code === 'empty_note'));
  });
});
