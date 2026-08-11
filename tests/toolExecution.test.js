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
      'Let me save that. ###TOOL###{"create_service_request":{"type":"order","item":"charger"}}###ENDTOOL### ###ENDCALL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities,
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
      '###TOOL###{"create_service_request":{"type":"hold","item":"charger","when_text":"evening"}}###ENDTOOL###'
    );
    const first = await executeBrainTools({
      parsed,
      capabilities,
      handlers: {
        createServiceRequest: async () => ({ id: 'req_1', request_type: 'hold' }),
      },
    });
    const fingerprint = first.results[0].fingerprint;
    const second = await executeBrainTools({
      parsed,
      capabilities,
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
