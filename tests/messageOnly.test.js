const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { buildContextHeader, buildSystemPrompt, CONVERSATION_RULES } = require('../src/prompts');
const { composeBusinessAssistantIntro } = require('../src/conversation/businessAssistantIntro');
const { createBrainState, formatBrainStateForPrompt } = require('../src/conversation/brainState');
const { fileReadLine } = require('../src/conversation/fileRead');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const {
  applyMessageOnlyCapabilities,
  isMessageOnlyMode,
  messageOnlyCallbackLine,
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
    assert.doesNotMatch(spoken, /\b9\b|tomorrow|\bAM\b|\bPM\b/i);
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

  it('answers a fact and refuses the booking ask', () => {
    const line = messageOnlyCallbackLine('en');
    const services = polishSpokenReply(
      'We offer carpet cleaning and pet stain removal. Which service would you like to book?',
      {
        state: { messageOnly: true },
        callerTurns: ['What services do you offer?'],
        profile: { afterHoursMode: 'message' },
        capabilities: { messageOnly: true },
        language: 'en',
      }
    );
    assert.match(services, /carpet cleaning/i);
    assert.doesNotMatch(services, /which service|book/i);
    assert.doesNotMatch(services, /take a message/i);

    const price = polishSpokenReply(
      'Carpet cleaning costs 3500 shillings. What time tomorrow?',
      {
        state: { messageOnly: true },
        callerTurns: ['How much is carpet cleaning, and can you come tomorrow?'],
        profile: {
          afterHoursMode: 'message',
          servicesCatalog: [{ name: 'Carpet cleaning', price_range: '3500' }],
        },
        capabilities: { messageOnly: true },
        language: 'en',
      }
    );
    assert.match(price, /3500/);
    assert.match(price, /take a message/i);
    assert.doesNotMatch(price, /what time|tomorrow/i);

    const hours = polishSpokenReply("We're open today.", {
      state: { messageOnly: true },
      callerTurns: ['Are you open?'],
      profile: { afterHoursMode: 'message', businessHours: '8 AM to 6 PM' },
      capabilities: { messageOnly: true },
      language: 'en',
    });
    assert.match(hours, /open today/i);
    const hoursLocal = resolveLocalReply({
      text: 'Are you open?',
      state: { messageOnly: true, conversation: {} },
      language: 'en',
      profile: { afterHoursMode: 'message', hoursSchedule: defaultHoursSchedule() },
      nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'time' },
    });
    assert.equal(hoursLocal.outcome, 'hours_ask');
    assert.match(hoursLocal.line, /open|closed/i);
    assert.doesNotMatch(hoursLocal.line, /what time/i);

    const place = polishSpokenReply("We're in Westlands.", {
      state: { messageOnly: true },
      callerTurns: ['Where are you?'],
      profile: { afterHoursMode: 'message', businessLocations: [{ name: 'Westlands' }] },
      capabilities: { messageOnly: true },
      language: 'en',
    });
    assert.match(place, /Westlands/);
    assert.doesNotMatch(place, /where should we/i);

    const booking = polishSpokenReply(
      'We offer carpet cleaning. Which service would you like to book? Tomorrow at 11. Where should we come?',
      {
        state: { messageOnly: true },
        callerTurns: ['I want to book a carpet clean tomorrow at 11 in Westlands.'],
        profile: { afterHoursMode: 'message' },
        capabilities: { messageOnly: true },
        language: 'en',
      }
    );
    assert.equal(booking, line);
    assert.doesNotMatch(booking, /which service|tomorrow|11|Westlands|where should/i);

    const named = polishSpokenReply('May I have your name? When should we come?', {
      state: { messageOnly: true },
      callerTurns: ['Please book a carpet clean.'],
      profile: { afterHoursMode: 'message' },
      capabilities: { messageOnly: true },
      language: 'en',
    });
    assert.match(named, /your name/i);
    assert.match(named, /take a message/i);
    assert.doesNotMatch(named, /when should we come/i);

    const serve = polishSpokenReply('Which service would you like to book?', {
      state: { messageOnly: false },
      callerTurns: ['I want to book a carpet clean.'],
      profile: { afterHoursMode: 'serve' },
      language: 'en',
    });
    assert.match(serve, /Which service would you like to book/);
  });

  it('does not ask for a visit slot on the local line', () => {
    const booked = resolveLocalReply({
      text: 'Tomorrow.',
      state: { messageOnly: true, conversation: {} },
      language: 'en',
      nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'time' },
    });
    assert.equal(booked.outcome, 'message_only');
    assert.equal(booked.line, messageOnlyCallbackLine('en'));
    assert.doesNotMatch(booked.line, /what time/i);

    const decision = determineNextBestAction({
      state: {
        messageOnly: true,
        intent: 'booking',
        goal: { missingSlots: ['when', 'location'], status: 'open', description: 'book' },
        conversation: { answersReceived: ['Book a carpet clean tomorrow'] },
        repair: { failureCount: 0 },
        resolution: {},
      },
      capabilities: { messageOnly: true },
    });
    assert.equal(decision.action, 'CAPTURE');
    assert.match(decision.reason, /Do not ask which service to book/);

    const priced = determineNextBestAction({
      state: {
        messageOnly: true,
        intent: 'booking',
        goal: { missingSlots: ['when'], status: 'open' },
        conversation: { answersReceived: ['How much is carpet cleaning?'] },
        repair: { failureCount: 0 },
        resolution: {},
      },
      capabilities: { messageOnly: true },
    });
    assert.equal(priced.action, 'ANSWER');
  });

  it('reads an asked-for catalogue and confirms a name on file', () => {
    const header = buildContextHeader({
      afterHoursMode: 'message',
      businessName: 'Done and Dusted',
      agentName: 'Aisha',
    });
    const prompt = buildSystemPrompt({
      afterHoursMode: 'message',
      businessName: 'Done and Dusted',
      agentName: 'Aisha',
      vertical: 'home_services',
    });
    const compiled = `${header}\n${CONVERSATION_RULES}\n${prompt}`;
    assert.match(compiled, /Do not list couch, carpet, mattress, or any job menu/);
    assert.match(compiled, /Do not pitch services/);
    assert.match(
      header,
      /If they ask what you offer, which services, or what you do, you MUST read the catalogue from the file/
    );
    assert.match(
      CONVERSATION_RULES,
      /If they ask what you offer, which services, or what you do, you MUST read the catalogue from the file/
    );
    assert.match(compiled, /beats the 25-word cap and the no-lists rule/);
    assert.match(compiled, /Do not ask what they need done instead/);
    assert.match(
      header,
      /you have my name, I called before, or my name is on file, you MUST ask once: Am I speaking with \{that name\}\?/
    );
    assert.match(
      CONVERSATION_RULES,
      /you have my name, I called before, or my name is on file, you MUST ask once: Am I speaking with \{that name\}\?/
    );
    assert.match(compiled, /Do not say there is no name saved/);
    assert.match(compiled, /Do not greet them as that name before they confirm/);
    assert.match(header, /Do not ask for a day, a time, or a place/);
    assert.match(header, /take a message and the team will call them/);
    assert.match(header, /Do not append create_appointment or update_appointment/);
    assert.doesNotMatch(header, /KEEP SERVING/);
  });
});


const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { observeCallerTurn } = require('../src/conversation/brainState');
const { composeBusinessAssistantIntro: composeIntro } = require('../src/conversation/businessAssistantIntro');

function messageTurn(state, text, profile) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

describe('message name lock', () => {
  const alvinCard = {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: false,
    greetByName: true,
    alternateNames: ['Brian'],
    nextAppointment: 'carpet, Thursday 10 AM',
    openVisits: ['carpet, Thursday 10 AM'],
  };

  it('asks the file name on the opener and does not ask it again', () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'message', callerMemory: { ...alvinCard } };
    assert.equal(
      composeIntro({
        businessName: 'Done and Dusted',
        agentName: 'Aisha',
        isOpen: true,
        afterHoursMode: 'message',
        callerFileName: 'Alvin',
        now: new Date('2026-08-13T10:00:00.000Z'),
      }),
      'Done and Dusted, this is Aisha. I can take a message. Am I speaking with Alvin?'
    );
    const state = createBrainState(profile);
    assert.equal(state.caller.fileNameAsked, 'Alvin');
    assert.equal(state.caller.fileNameAskSpoken, true);
    const hello = messageTurn(state, 'Hello', profile);
    assert.equal(hello.caller.nameConfirmed, false);
    assert.equal(hello.caller.fileNameAsked, 'Alvin');
    const prompt = formatBrainStateForPrompt(hello);
    assert.match(prompt, /File name already asked: Alvin/);
    assert.match(prompt, /Do not ask for a name/);
    assert.doesNotMatch(prompt, /Thursday 10 AM/);
    assert.doesNotMatch(prompt, /Ask once: Am I speaking with Alvin/);
    const decision = determineNextBestAction({
      state: { ...hello, intent: 'booking', goal: { missingSlots: ['name', 'when'], status: 'open' } },
      capabilities: locked,
    });
    assert.doesNotMatch(String(decision.reason || ''), /May I have your name|Ask once: Am I speaking/i);
  });

  it('binds yes only after the file-name ask and ignores a compliment', () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'message', callerMemory: { ...alvinCard } };
    const state = createBrainState(profile);
    state.caller.fileNameAskSpoken = false;
    state.caller.fileNameAsked = null;
    const early = messageTurn(state, 'Yes', profile);
    assert.equal(early.caller.nameConfirmed, false);

    const asked = createBrainState(profile);
    const bound = messageTurn(asked, 'Yes', profile);
    assert.equal(bound.caller.name, 'Alvin');
    assert.equal(bound.caller.nameConfirmed, true);
    assert.equal(bound.entities.name.source, 'caller_file');
    assert.doesNotMatch(formatBrainStateForPrompt(bound), /Thursday 10 AM/);

    const junk = messageTurn(createBrainState(profile), "Actually, I'm impressed by your work", profile);
    assert.equal(junk.caller.name, null);
    assert.equal(junk.caller.nameConfirmed, false);
    assert.equal(junk.caller.fileNameAsked, 'Alvin');
  });

  it('does not keep an I am span that is not the file name', () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'message', callerMemory: { ...alvinCard } };
    const state = messageTurn(createBrainState(profile), "I'm Brian", profile);
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    assert.equal(state.caller.name, null);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /Thursday/);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /nothing is saved/i);
  });

  it('asks once when no name is on file and does not auto-confirm I am', () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'message' };
    const said = messageTurn(createBrainState(profile), "I'm Alvin", profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.equal(said.caller.nameConfirmed, false);
    assert.equal(said.entities.name.source, 'caller_im');
    assert.match(formatBrainStateForPrompt(said), /Do not ask for the name again/);
    const continued = messageTurn(said, 'Please call me about the sofa', profile);
    assert.equal(continued.caller.name, 'Alvin');
    assert.equal(continued.caller.nameConfirmed, true);
    const junk = messageTurn(createBrainState(profile), "Actually, I'm impressed by your work", profile);
    assert.equal(junk.caller.name, null);
  });

  it('saves the held name on the callback and still drops a clock', async () => {
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"callback","name":"impressed by your","item":"Call about the sofa","when_text":"tomorrow at 9 AM"}}###ENDTOOL###'
    );
    let saved = null;
    const execution = await executeBrainTools({
      parsed,
      capabilities: locked,
      heldCallerName: 'Alvin',
      handlers: {
        createServiceRequest: async (request) => {
          saved = request;
          return { id: 'req_1', request_type: request.type, status: 'open' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.name, 'Alvin');
    assert.equal(saved.whenText, '');
    assert.doesNotMatch(JSON.stringify(saved), /9 AM|impressed/i);

    const onlyClock = parseGeminiResponse(
      '###TOOL###{"create_service_request":{"type":"callback","name":"Jane","when_text":"tomorrow at 9 AM"}}###ENDTOOL###'
    );
    let clockCalls = 0;
    const clocked = await executeBrainTools({
      parsed: onlyClock,
      capabilities: locked,
      handlers: {
        createServiceRequest: async () => {
          clockCalls += 1;
          return { id: 'req_2' };
        },
      },
    });
    assert.equal(clockCalls, 0);
    assert.notEqual(clocked.results[0].status, 'succeeded');
  });

  it('does not set the file-name ask on the full assistant', () => {
    const serve = createBrainState({
      afterHoursMode: 'serve',
      callerMemory: { name: 'Alvin', fileOwnerName: 'Alvin' },
    });
    assert.equal(serve.messageOnly, false);
    assert.equal(serve.caller.fileNameAskSpoken, false);
    assert.equal(serve.caller.fileNameAsked, null);
  });
});
