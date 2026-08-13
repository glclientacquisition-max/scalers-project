const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');

const capabilities = {
  createServiceRequest: true,
  saveCallerInfo: true,
  escalate: true,
  endCall: true,
};

describe('validated tool execution', () => {
  it('confirms a request only after backend success', async () => {
    const parsed = parseGeminiResponse(
      'Let me save that. ###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"HP printer","when_text":"5 PM"}}###ENDTOOL### ###ENDCALL###'
    );
    let calls = 0;
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [{ name: 'HP printer' }],
      handlers: {
        createServiceRequest: async (request) => {
          calls += 1;
          return { id: 'req_1', request_type: request.type };
        },
        saveCallerInfo: async ({ name, reason }) => ({ name, reason }),
      },
    });

    assert.equal(calls, 1);
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(execution.shouldEndCall, true);
    assert.equal(
      formatToolConfirmation(execution.results, 'en'),
      "Done — I've saved your request."
    );
  });

  it('reports failure and prevents end-call when the backend fails', async () => {
    const parsed = parseGeminiResponse(
      'Let me save that. ###TOOL###{"create_service_request":{"type":"order","name":"Ali","item":"charger"}}###ENDTOOL### ###ENDCALL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [{ name: 'charger' }],
      handlers: {
        createServiceRequest: async () => null,
      },
    });

    assert.equal(execution.results[0].status, 'failed');
    assert.equal(execution.shouldEndCall, false);
    assert.equal(
      formatToolConfirmation(execution.results, 'en'),
      "I couldn't save that request right now."
    );
  });

  it('deduplicates a completed request fingerprint', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Sam","item":"charger","when_text":"evening"}}###ENDTOOL###'
    );
    const catalog = [{ name: 'charger' }];
    const first = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: catalog,
      handlers: {
        createServiceRequest: async () => ({ id: 'req_1', request_type: 'hold' }),
      },
    });
    const fingerprint = first.results[0].fingerprint;
    const second = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: catalog,
      completedFingerprints: [fingerprint],
      handlers: {
        createServiceRequest: async () => {
          throw new Error('must not execute duplicate');
        },
      },
    });

    assert.equal(second.results[0].status, 'duplicate');
    assert.equal(formatToolConfirmation(second.results, 'en'), 'That request is already saved.');
  });

  it('rejects incomplete holds without writing a row', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","item":"Atomic Habits"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.deepEqual(execution.results[0].missingSlots, ['name', 'when_text']);
    assert.match(
      formatToolConfirmation(execution.results, 'en'),
      /name and when you will pick up/i
    );
  });

  it('rejects holds for titles missing from the grounded catalogue', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"Atomic Habits","when_text":"tomorrow 5pm"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [{ name: 'Rich Dad Poor Dad', category: 'Finance' }],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'catalog_miss');
    assert.match(
      formatToolConfirmation(execution.results, 'en'),
      /enquiry or quote/i
    );
  });

  it('normalizes hold_or_pickup and grounds matching catalogue titles', async () => {
    let saved = null;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold_or_pickup","name":"Sam","item":"rich dad","when_text":"evening"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [
        { name: 'Rich Dad Poor Dad', aliases: ['rich dad'] },
        { name: 'Think and Grow Rich' },
      ],
      handlers: {
        createServiceRequest: async (request) => {
          saved = request;
          return { id: 'req_2', request_type: request.type };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.type, 'hold');
    assert.equal(saved.item, 'Rich Dad Poor Dad');
  });

  it('updates an existing hold when when_text is refined instead of creating a second row', async () => {
    const catalog = [{ name: 'The Smart Money Tribe' }];
    const firstParsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Brian","item":"The Smart Money Tribe","when_text":"Tomorrow"}}###ENDTOOL###'
    );
    const first = await executeBrainTools({
      parsed: firstParsed,
      capabilities,
      productCatalog: catalog,
      handlers: {
        createServiceRequest: async (request) => ({
          id: 'hold_1',
          request_type: request.type,
        }),
      },
    });
    assert.equal(first.results[0].status, 'succeeded');

    const { recordActionResults, createBrainState } = require('../src/conversation/brainState');
    const state = recordActionResults(createBrainState(), first.results);

    let creates = 0;
    let updates = 0;
    let updatedPayload = null;
    const secondParsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Brian","item":"The Smart Money Tribe","when_text":"Tomorrow at 5:00 PM"}}###ENDTOOL###'
    );
    const second = await executeBrainTools({
      parsed: secondParsed,
      capabilities,
      productCatalog: catalog,
      priorHolds: state.actions.openHolds,
      completedFingerprints: state.actions.completedFingerprints,
      handlers: {
        createServiceRequest: async () => {
          creates += 1;
          return { id: 'should_not' };
        },
        updateServiceRequest: async (request) => {
          updates += 1;
          updatedPayload = request;
          return {
            id: request.id,
            request_type: 'hold',
            when_text: request.whenText,
          };
        },
      },
    });

    assert.equal(creates, 0);
    assert.equal(updates, 1);
    assert.equal(second.results[0].status, 'updated');
    assert.equal(updatedPayload.id, 'hold_1');
    assert.equal(updatedPayload.whenText, 'Tomorrow at 5:00 PM');
    assert.match(
      formatToolConfirmation(second.results, 'en'),
      /updated your hold/i
    );
  });

  it('rejects garbled STT sentences as order titles (private beta trust gate)', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"order","name":"Jane","item":"I have to make habits"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [{ name: 'Rich Dad Poor Dad', category: 'Finance' }],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'title_unclear');
    assert.match(formatToolConfirmation(execution.results, 'en'), /exact book title/i);
  });

  it('rejects orders for titles missing from the grounded catalogue', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"order","name":"Jane","item":"Zorkonian Chronicles"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [{ name: 'Rich Dad Poor Dad', category: 'Finance' }],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'catalog_miss');
    assert.match(formatToolConfirmation(execution.results, 'en'), /enquiry or quote/i);
  });

  it('rejects orders that use the agent name as the caller name', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"order","name":"Aisha","item":"King Series"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      agentName: 'Aisha',
      businessName: 'ChapterOne Bookstore',
      productCatalog: [{ name: 'King Series' }],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'bad_caller_name');
    assert.match(formatToolConfirmation(execution.results, 'en'), /your name/i);
  });

  it('rejects holds when no product catalogue is loaded', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"King Series","when_text":"tomorrow"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].code, 'catalog_required');
  });

  it('rejects escalation when the caller name is the agent', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"escalate":{"teammate":"manager","name":"Aisha","reason":"wants manager"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      agentName: 'Aisha',
      handlers: {
        escalate: async () => ({ ok: true, channel: 'whatsapp' }),
      },
    });
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'bad_caller_name');
  });

  it('grounds matching catalogue titles on orders', async () => {
    let saved = null;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"order","name":"Sam","item":"rich dad"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      productCatalog: [
        { name: 'Rich Dad Poor Dad', aliases: ['rich dad'] },
        { name: 'Think and Grow Rich' },
      ],
      handlers: {
        createServiceRequest: async (request) => {
          saved = request;
          return { id: 'req_3', request_type: request.type };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.type, 'order');
    assert.equal(saved.item, 'Rich Dad Poor Dad');
  });

  it('rejects orders missing a caller name', async () => {
    let calls = 0;
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"order","item":"Notebook"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'should_not' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.deepEqual(execution.results[0].missingSlots, ['name']);
    assert.match(formatToolConfirmation(execution.results, 'en'), /name/i);
  });

  it('rejects escalation without a caller name', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"escalate":{"teammate":"manager","reason":"wants manager"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        escalate: async () => ({ ok: true, channel: 'whatsapp' }),
      },
    });
    assert.equal(execution.results[0].status, 'invalid');
    assert.deepEqual(execution.results[0].missingSlots, ['name']);
    assert.match(formatToolConfirmation(execution.results, 'en'), /your name/i);
  });

  it('confirms soft escalation when desk note is saved', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"escalate":{"teammate":"manager","name":"Brian","reason":"wants manager"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        escalate: async () => ({ ok: true, soft: true, channel: 'desk_note' }),
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.match(
      formatToolConfirmation(execution.results, 'en'),
      /noted that for the team/i
    );
  });

  it('does not confirm escalation without a working channel', async () => {
    const parsed = parseGeminiResponse(
      'I will try to send that. ###TOOL###{"escalate":{"teammate":"Manager","name":"Ali","reason":"Caller requested manager"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        saveCallerInfo: async ({ name, reason }) => ({ name, reason }),
        escalate: async () => ({ ok: false, reason: 'No working channel.' }),
      },
    });

    const escalation = execution.results.find((result) => result.action === 'escalate');
    assert.equal(escalation.status, 'failed');
    assert.equal(
      formatToolConfirmation(execution.results, 'en'),
      "I couldn't send that request right now."
    );
  });

  it('turns malformed marker JSON into a caller-safe failure', async () => {
    const parsed = parseGeminiResponse(
      'Let me do that. ###TOOL###{"create_service_request": ###ENDTOOL###'
    );
    const execution = await executeBrainTools({ parsed, capabilities });
    assert.equal(execution.results[0].action, 'tool_request');
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(
      formatToolConfirmation(execution.results, 'en'),
      "I couldn't complete that action."
    );
  });
});
