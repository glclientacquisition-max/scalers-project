const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { buildContextHeader } = require('../src/prompts');
const { composeBusinessAssistantIntro } = require('../src/conversation/businessAssistantIntro');
const { createBrainState, formatBrainStateForPrompt } = require('../src/conversation/brainState');
const { fileReadLine } = require('../src/conversation/fileRead');
const {
  applyMessageOnlyCapabilities,
  isMessageOnlyMode,
} = require('../src/conversation/messageOnly');

const locked = {
  createServiceRequest: true,
  createAppointment: true,
  updateAppointment: true,
  saveCallerInfo: true,
  escalate: true,
  endCall: true,
  messageOnly: true,
};

describe('message only lock', () => {
  it('treats only the stored message mode as the lock', () => {
    assert.equal(isMessageOnlyMode('message'), true);
    assert.equal(isMessageOnlyMode(' Message '), true);
    assert.equal(isMessageOnlyMode('serve'), false);
    assert.equal(isMessageOnlyMode(''), false);
    const serve = applyMessageOnlyCapabilities(
      { createAppointment: true, updateAppointment: true },
      'serve'
    );
    assert.equal(serve.createAppointment, true);
    assert.equal(serve.messageOnly, undefined);
    const message = applyMessageOnlyCapabilities(
      { createAppointment: true, updateAppointment: true, createServiceRequest: true },
      'message'
    );
    assert.equal(message.messageOnly, true);
    assert.equal(message.createAppointment, false);
    assert.equal(message.updateAppointment, false);
    assert.equal(message.createServiceRequest, true);
  });

  it('refuses a booking even when appointment tools are otherwise on', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Carpet","name":"Jane","when_text":"tomorrow at 9 AM","location":"Kilimani gate"}}###ENDTOOL###'
    );
    let calls = 0;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      handlers: {
        createAppointment: async () => {
          calls += 1;
          return { id: 'appt_1', status: 'requested' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].action, 'create_appointment');
    assert.equal(execution.results[0].status, 'disabled');
    assert.equal(execution.results[0].code, 'message_only');
    const spoken = formatToolConfirmation(execution.results, 'en');
    assert.match(spoken, /take a message/i);
    assert.doesNotMatch(spoken, /\b9\b|tomorrow|AM|PM/i);
  });

  it('refuses a cancel', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"update_appointment":{"status":"cancelled"}}###ENDTOOL###'
    );
    let calls = 0;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      handlers: {
        updateAppointment: async () => {
          calls += 1;
          return { id: 'appt_1', status: 'cancelled' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].action, 'update_appointment');
    assert.equal(execution.results[0].code, 'message_only');
    const spoken = formatToolConfirmation(execution.results, 'en');
    assert.match(spoken, /take a message/i);
    assert.doesNotMatch(spoken, /I've cancelled|cancelled that visit/i);
  });

  it('saves a named callback and drops any clock time', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"callback","name":"Jane","item":"Please call about the sofa","when_text":"tomorrow at 9 AM"}}###ENDTOOL###'
    );
    let saved = null;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      handlers: {
        createServiceRequest: async (request) => {
          saved = request;
          return { id: 'req_1', request_type: request.type, status: 'open' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.type, 'callback');
    assert.equal(saved.name, 'Jane');
    assert.equal(saved.whenText, '');
    assert.doesNotMatch(saved.notes || '', /9 AM/);
    assert.match(formatToolConfirmation(execution.results, 'en'), /saved your request/i);
  });

  it('refuses a hold or order', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"HP printer","when_text":"5 PM"}}###ENDTOOL###'
    );
    let calls = 0;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      productCatalog: [{ name: 'HP printer' }],
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'req_1' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('asks for a name before saving a callback', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"callback","notes":"Call about the sofa"}}###ENDTOOL###'
    );
    let calls = 0;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      handlers: {
        createServiceRequest: async () => {
          calls += 1;
          return { id: 'req_1' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.deepEqual(execution.results[0].missingSlots, ['name']);
  });

  it('does not inject a visit when the lock is on', () => {
    const next = ensureRequiredCreateRequest(
      {
        appointment: {
          serviceName: 'Carpet',
          name: 'Jane',
          whenText: 'tomorrow at 9 AM',
          landmark: 'Kilimani gate',
        },
      },
      { messageOnly: true, resolution: { nextBestAction: 'CREATE_REQUEST' } },
      locked
    );
    assert.equal(next.appointment, undefined);
    assert.equal(next.appointmentUpdate, undefined);
  });

  it('does not read open visits into the prompt', () => {
    const truth = buildLiveGroundTruth({
      afterHoursMode: 'message',
      servicesCatalog: [{ name: 'Carpet cleaning' }],
      openAppointments: [
        { when_text: 'Tue 10 AM', service_name: 'Carpet cleaning', status: 'requested' },
      ],
    });
    assert.doesNotMatch(truth, /OPEN VISITS/);
    assert.doesNotMatch(truth, /Tue 10 AM/);

    const header = buildContextHeader({
      afterHoursMode: 'message',
      businessName: 'ChapterOne',
      agentName: 'Aisha',
      callerMemory: {
        name: 'Jane',
        greetByName: true,
        identityBound: true,
        nextAppointment: 'carpet Tuesday at 10 AM',
        openVisits: ['carpet Tuesday at 10 AM'],
      },
    });
    assert.match(header, /MESSAGE ONLY/);
    assert.match(header, /hard lock/);
    assert.doesNotMatch(header, /Tuesday at 10 AM/);
    assert.doesNotMatch(header, /KEEP SERVING/);

    const serve = buildContextHeader({
      afterHoursMode: 'serve',
      businessName: 'ChapterOne',
      agentName: 'Aisha',
      isOpen: false,
    });
    assert.doesNotMatch(serve, /MESSAGE ONLY/);

    const state = createBrainState({
      afterHoursMode: 'message',
      callerMemory: {
        name: 'Jane',
        greetByName: true,
        identityBound: true,
        nextAppointment: 'carpet Tuesday at 10 AM',
      },
    });
    const callState = formatBrainStateForPrompt(state);
    assert.doesNotMatch(callState, /Tuesday at 10 AM/);
    assert.doesNotMatch(callState, /create_appointment/);

    const line = fileReadLine({
      text: 'what do I have',
      state: {
        messageOnly: true,
        returning: {
          identityBound: true,
          nextVisit: 'carpet Tuesday at 10 AM',
          openVisits: ['carpet Tuesday at 10 AM'],
        },
      },
    });
    assert.match(line, /take a message/i);
    assert.doesNotMatch(line, /Tuesday/);
  });

  it('asks for a name on an open message-only line and leaves serve alone', () => {
    const afternoon = new Date('2026-08-13T10:00:00.000Z');
    assert.equal(
      composeBusinessAssistantIntro({
        businessName: 'ChapterOne Bookstore',
        agentName: 'Aisha',
        isOpen: true,
        afterHoursMode: 'message',
        now: afternoon,
      }),
      'ChapterOne Bookstore, this is Aisha. I can take a message. May I have your name?'
    );
    assert.equal(
      composeBusinessAssistantIntro({
        businessName: 'ChapterOne Bookstore',
        agentName: 'Aisha',
        isOpen: true,
        afterHoursMode: 'serve',
        now: afternoon,
      }),
      'ChapterOne Bookstore, this is Aisha. How can I help?'
    );
  });
});
