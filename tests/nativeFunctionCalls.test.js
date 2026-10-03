const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DAY_ONE_FUNCTION_NAMES,
  dayOneFunctionDeclarations,
  geminiToolsConfig,
  parseFunctionCalls,
  parseGeminiTools,
  extractGeminiFunctionCalls,
  stripToolTextForSpeech,
} = require('../src/conversation/geminiFunctions');
const {
  NODE_ID,
  callerFileSpeech,
  callerFileOwnsSpeech,
  callerFileLocalReply,
} = require('../src/conversation/callerFile');
const {
  spokenTextForToolTurn,
  DEFAULT_TURN_TIMEOUT_MS,
  geminiTurnTimeoutMs,
  HOLD_SPEECH_UNTIL_TOOLS_CLOSE,
  partsHaveFunctionCalls,
} = require('../src/conversation/geminiVoice');
const { createSpokenStreamBuffer } = require('../src/speech/spokenStreamBuffer');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { ensureRequiredEscalate: escalateOnly } = require('../src/conversation/requiredEscalate');
const { formatNameConfirmForPrompt } = require('../src/conversation/brainState');
const { buildSystemPrompt } = require('../src/prompts');

describe('day-one native functions', () => {
  it('declares only the six day-one functions', () => {
    const names = dayOneFunctionDeclarations().map((row) => row.name);
    assert.deepEqual(names, [...DAY_ONE_FUNCTION_NAMES]);
  });

  it('uses landmark not location on create_appointment', () => {
    const create = dayOneFunctionDeclarations().find(
      (row) => row.name === 'create_appointment'
    );
    assert.ok(create.parameters.properties.landmark);
    assert.equal(create.parameters.properties.location, undefined);
  });

  it('geminiToolsConfig exposes functionDeclarations', () => {
    const cfg = geminiToolsConfig();
    assert.ok(cfg.tools[0].functionDeclarations.length >= 5);
  });
});

describe('parseFunctionCalls / parseGeminiTools', () => {
  it('executes save_caller_info from a function call (not injected)', () => {
    const parsed = parseFunctionCalls([
      { name: 'save_caller_info', args: { name: 'Amina', reason: 'carpet' } },
    ]);
    assert.equal(parsed.name, 'Amina');
    assert.equal(parsed.reason, 'carpet');
    assert.equal(parsed.holdSpeechUntilToolsClose, true);
    assert.equal(parsed.serviceRequest, null);
    assert.equal(parsed.escalate, null);
  });

  it('maps create_appointment landmark from a function call', () => {
    const parsed = parseFunctionCalls([
      {
        name: 'create_appointment',
        args: {
          service_name: 'Carpet cleaning',
          name: 'Amina',
          when_text: 'Tuesday 10 AM',
          landmark: 'Rongai',
        },
      },
    ]);
    assert.equal(parsed.appointment.landmark, 'Rongai');
    assert.equal(parsed.appointment.serviceName, 'Carpet cleaning');
  });

  it('maps ###TOOL### blocks onto the same functions and strips speech', () => {
    const parsed = parseGeminiTools({
      text: 'Thanks. ###TOOL###{"save_caller_info":{"name":"Jane","reason":"hold"}}###ENDTOOL###',
    });
    assert.equal(parsed.name, 'Jane');
    assert.doesNotMatch(parsed.spokenText, /###TOOL###|save_caller_info|\{/);
    assert.equal(parsed.holdSpeechUntilToolsClose, true);
  });

  it('does not speak raw JSON tool payloads', () => {
    const parsed = parseGeminiTools({
      text: 'Okay {"create_appointment":{"service_name":"Carpet","name":"A","when_text":"Tue","landmark":"Rongai"}}',
    });
    assert.equal(parsed.appointment.landmark, 'Rongai');
    assert.doesNotMatch(parsed.spokenText, /create_appointment|landmark|\{/);
  });

  it('extracts functionCall parts from a Gemini response shape', () => {
    const calls = extractGeminiFunctionCalls({
      candidates: [
        {
          content: {
            parts: [
              { text: 'hidden tool talk' },
              {
                functionCall: {
                  name: 'escalate',
                  args: { teammate: 'manager', name: 'Sam', reason: 'owner' },
                },
              },
            ],
          },
        },
      ],
    });
    assert.equal(calls[0].name, 'escalate');
    assert.equal(partsHaveFunctionCalls([{ functionCall: calls[0] }]), true);
  });
});

describe('injectors stay backup only', () => {
  it('does not inject save_caller_info', () => {
    const parsed = { spokenText: 'Hello', name: null, reason: null };
    const state = {
      caller: { name: 'Amina', nameConfirmed: true },
      resolution: { nextBestAction: 'ANSWER' },
      goal: { missingSlots: [] },
      entities: {},
    };
    // No save injector exists. ensureRequired* leave name null.
    const afterCreate = ensureRequiredCreateRequest(parsed, state, {
      createAppointment: true,
    });
    const afterEsc = escalateOnly(afterCreate, state, { escalate: true });
    assert.equal(afterEsc.name, null);
    assert.equal(afterEsc.escalate ?? null, null);
  });

  it('does not inject create unless next action is CREATE_REQUEST', () => {
    const state = {
      vertical: 'home_services',
      intent: 'booking',
      caller: { name: 'Amina', nameConfirmed: true },
      entities: {
        service: { value: 'Carpet cleaning', confirmed: true },
        time_window: { value: 'Tuesday 10 AM', confirmed: true },
        location: { value: 'Rongai', confirmed: true },
      },
      goal: { missingSlots: [] },
      resolution: { nextBestAction: 'ANSWER' },
    };
    const out = ensureRequiredCreateRequest(
      { spokenText: '' },
      state,
      { createAppointment: true }
    );
    assert.equal(out.appointment, undefined);
  });

  it('injects escalate only when next action is ESCALATE and name known', () => {
    const ready = {
      intent: 'human',
      caller: { name: 'Amina' },
      handoff: { requested: true, reason: 'Caller requested manager' },
      resolution: { nextBestAction: 'ESCALATE' },
      goal: { missingSlots: [], description: 'speak to manager' },
      entities: {},
    };
    const injected = escalateOnly({ spokenText: '' }, ready, { escalate: true });
    assert.equal(injected.escalate.name, 'Amina');

    const notYet = {
      intent: 'booking',
      caller: { name: 'Amina' },
      resolution: { nextBestAction: 'ASK_CLARIFICATION' },
      goal: { missingSlots: ['time'] },
      entities: {},
    };
    const skipped = escalateOnly({ spokenText: '' }, notYet, { escalate: true });
    assert.equal(skipped.escalate ?? null, null);
  });
});

describe('caller_file owns visit existence', () => {
  it('names the node caller_file', () => {
    assert.equal(NODE_ID, 'caller_file');
  });

  it('already-bound caller with open rows hears only the code line', () => {
    const state = {
      vertical: 'home_services',
      language: { current: 'en' },
      returning: {
        identityBound: true,
        fileRole: 'primary',
        openVisits: [
          'carpet cleaning | tomorrow | requested | Rongai',
          'carpet cleaning | Friday | requested | Westlands',
        ],
      },
    };
    const line = callerFileSpeech({ state, mode: 'save', language: 'en' });
    assert.match(line, /You have carpet cleaning, tomorrow, Rongai/);
    assert.match(line, /You have carpet cleaning, Friday, Westlands/);
    assert.match(line, /What would you like to do/);
    assert.doesNotMatch(line, /don't have a booking|I don't have/i);
    assert.equal(
      spokenTextForToolTurn({
        spoken: "I don't have a booking for you.",
        toolResults: [{ action: 'save_caller_info', status: 'succeeded' }],
      }),
      ''
    );
    assert.equal(callerFileOwnsSpeech({ state, toolResults: [{ action: 'save_caller_info', status: 'succeeded' }] }), true);
  });

  it('empty file hears only the existing code sentence', () => {
    const state = {
      vertical: 'home_services',
      language: { current: 'en' },
      returning: { identityBound: true, fileRole: 'primary', openVisits: [] },
    };
    const local = callerFileLocalReply({
      text: 'Which bookings do I have?',
      state,
      language: 'en',
    });
    assert.equal(local.line, "I don't have a booking for you.");
    assert.equal(local.node, 'caller_file');
  });

  it('other tool turns produce no model speech', () => {
    assert.equal(
      spokenTextForToolTurn({
        spoken: 'Let me book that for you.',
        toolResults: [{ action: 'create_appointment', status: 'succeeded' }],
      }),
      ''
    );
    assert.equal(
      spokenTextForToolTurn({
        spoken: 'I notified the manager.',
        toolResults: [{ action: 'escalate', status: 'succeeded' }],
      }),
      ''
    );
  });
});

describe('holdSpeechUntilToolsClose', () => {
  it('exports the exact flag name', () => {
    assert.equal(HOLD_SPEECH_UNTIL_TOOLS_CLOSE, 'holdSpeechUntilToolsClose');
  });

  it('holds stream speech when the flag is set for function-call parts', () => {
    const buf = createSpokenStreamBuffer({ holdSpeechUntilToolsClose: true });
    assert.deepEqual(buf.push('You have two carpet visits open.'), []);
    assert.equal(buf.getHoldSpeechUntilToolsClose(), true);
    assert.deepEqual(buf.finish(), []);
  });

  it('does not speak a ###TOOL### block or raw JSON tool text', () => {
    const buf = createSpokenStreamBuffer();
    assert.deepEqual(
      buf.push(
        'Thanks. ###TOOL###{"save_caller_info":{"name":"Jane"}}###ENDTOOL###'
      ),
      []
    );
    assert.deepEqual(
      buf.push('{"create_appointment":{"service_name":"Carpet","name":"A","when_text":"Tue","landmark":"Rongai"}}'),
      []
    );
    assert.equal(stripToolTextForSpeech('Hi ###TOOL###{"escalate":{"name":"A"}}###ENDTOOL###'), 'Hi');
  });
});

describe('identify states and timeout', () => {
  it('keeps the three identify prompt states', () => {
    const collision = formatNameConfirmForPrompt({
      caller: { name: 'Alvin', nameCollision: ['Alvin', 'Kelvin'] },
    });
    assert.match(collision, /Name collision/);
    assert.match(collision, /Do not call save_caller_info/);

    const confirmed = formatNameConfirmForPrompt({
      caller: { name: 'Amina', nameConfirmed: true },
    });
    assert.match(confirmed, /confirmed/);
    assert.match(confirmed, /You may call save_caller_info/);

    const known = formatNameConfirmForPrompt({
      caller: { name: 'Amina', nameConfirmed: false },
    });
    assert.match(known, /known/);
    assert.match(known, /Do not call save_caller_info until they confirm/);
  });

  it('leaves GEMINI_TURN_TIMEOUT_MS default at 8000', () => {
    const prev = process.env.GEMINI_TURN_TIMEOUT_MS;
    delete process.env.GEMINI_TURN_TIMEOUT_MS;
    assert.equal(DEFAULT_TURN_TIMEOUT_MS, 8000);
    assert.equal(geminiTurnTimeoutMs(), 8000);
    if (prev == null) delete process.env.GEMINI_TURN_TIMEOUT_MS;
    else process.env.GEMINI_TURN_TIMEOUT_MS = prev;
  });

  it('prompt forbids model visit existence claims and ###TOOL### print', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Test Co',
      agentName: 'Shy',
      vertical: 'home_services',
    });
    assert.match(prompt, /Never say a visit does or does not exist/);
    assert.match(prompt, /do not print ###TOOL###/);
    assert.match(prompt, /landmark/);
    assert.doesNotMatch(prompt, /If you append ONLY save_caller_info, you MUST speak/);
  });
});
