const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const { executeBrainTools } = require('../src/conversation/toolExecution');
const {
  DAY_ONE_FUNCTION_NAMES,
  NATIVE_FUNCTIONS_PROMPT_NOTE,
  dayOneFunctionDeclarations,
  extractGeminiFunctionCalls,
  hasGeminiFunctionCall,
  mergeNativeFunctionCalls,
  nativeFunctionToolsConfig,
  nativeFunctionsEnabled,
  stripToolTextForSpeech,
  withNativeFunctionsPrompt,
} = require('../src/conversation/geminiFunctions');
const {
  appendGeminiStreamParts,
  buildGeminiContents,
  extractGeminiParts,
  modelPartsForHistory,
} = require('../src/conversation/geminiVoice');

const ON = { BRAIN_NATIVE_FUNCTIONS: 'on' };
const OFF = {};

const capabilities = {
  createServiceRequest: true,
  createAppointment: true,
  updateAppointment: true,
  saveCallerInfo: true,
  escalate: true,
  endCall: true,
};

function fnResponse(text, calls) {
  const parts = [];
  if (text) parts.push({ text });
  for (const [name, args] of calls) parts.push({ functionCall: { name, args } });
  return { candidates: [{ content: { parts } }] };
}

function schemaKeys(decl) {
  return Object.keys(decl.parameters?.properties || {});
}

describe('native functions flag', () => {
  it('is off by default and leaves the voice config and prompt as they were', () => {
    assert.equal(nativeFunctionsEnabled(OFF), false);
    assert.deepEqual(nativeFunctionToolsConfig({ env: OFF }), {});
    assert.equal(withNativeFunctionsPrompt('BASE', OFF), 'BASE');
  });

  it('declares the day-one tools when on, with no response JSON schema', () => {
    assert.equal(nativeFunctionsEnabled(ON), true);
    const cfg = nativeFunctionToolsConfig({ env: ON });
    const names = cfg.tools[0].functionDeclarations.map((d) => d.name);
    assert.deepEqual(names, [...DAY_ONE_FUNCTION_NAMES]);
    assert.equal('responseSchema' in cfg, false);
    assert.equal('responseMimeType' in cfg, false);
    assert.equal('responseJsonSchema' in cfg, false);
    const prompt = withNativeFunctionsPrompt('BASE', ON);
    assert.ok(prompt.startsWith('BASE'));
    assert.ok(prompt.includes(NATIVE_FUNCTIONS_PROMPT_NOTE));
    assert.equal(withNativeFunctionsPrompt(prompt, ON), prompt);
  });

  it('can leave escalate and end_call undeclared', () => {
    const names = dayOneFunctionDeclarations({ escalate: false, endCall: false }).map((d) => d.name);
    assert.deepEqual(names, [
      'save_caller_info',
      'create_service_request',
      'create_appointment',
      'update_appointment',
    ]);
  });
});

describe('caller name stays code-held', () => {
  it('no declaration lets the model pass a caller name or phone', () => {
    for (const decl of dayOneFunctionDeclarations()) {
      const keys = schemaKeys(decl);
      for (const banned of ['name', 'caller_name', 'callerName', 'full_name', 'phone']) {
        assert.equal(keys.includes(banned), false, `${decl.name} declares ${banned}`);
      }
    }
  });

  it('drops a name the model sends on save_caller_info and escalate', () => {
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(''),
      fnResponse('', [
        ['save_caller_info', { name: 'Impressed By Your', reason: 'cleaning' }],
        ['escalate', { name: 'Impressed', caller_name: 'X', reason: 'wants the owner' }],
      ])
    );
    assert.equal(parsed.name, null);
    assert.equal(parsed.callerInfoRequested, true);
    assert.equal(parsed.droppedModelName, true);
    assert.equal(parsed.reason, 'cleaning');
    assert.equal(parsed.escalate.name, '');
    assert.equal(parsed.escalate.reason, 'wants the owner');
  });

  it('a marker name in the same turn as native save_caller_info is dropped too', () => {
    const text =
      'Sawa. ###TOOL###{"save_caller_info":{"name":"Brian","reason":"x"}}###ENDTOOL###';
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(text),
      fnResponse('', [['save_caller_info', { reason: 'repair' }]])
    );
    assert.equal(parsed.name, null);
    assert.equal(parsed.reason, 'repair');
  });

  it('save_caller_info saves only the name the code holds', async () => {
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(''),
      fnResponse('', [['save_caller_info', { name: 'Brian', reason: 'deep clean' }]])
    );
    const saved = [];
    const execution = await executeBrainTools({
      parsed,
      capabilities,
      nameConfirmed: true,
      heldCallerName: 'Alvin',
      handlers: { saveCallerInfo: async (info) => (saved.push(info), info) },
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Alvin');
    assert.equal(saved[0].reason, 'deep clean');
    assert.equal(execution.results.find((r) => r.action === 'save_caller_info').status, 'succeeded');
  });

  it('with no held name, save_caller_info keeps the reason and invents no name', async () => {
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(''),
      fnResponse('', [['save_caller_info', { name: 'Brian', reason: 'deep clean' }]])
    );
    const saved = [];
    await executeBrainTools({
      parsed,
      capabilities,
      nameConfirmed: false,
      heldCallerName: '',
      handlers: { saveCallerInfo: async (info) => (saved.push(info), info) },
    });
    for (const info of saved) assert.equal(info.name, '');
  });

  it('escalate carries the held name, and is not sent with no held name', async () => {
    const heldNames = [];
    const withHeld = await executeBrainTools({
      parsed: mergeNativeFunctionCalls(
        parseGeminiResponse(''),
        fnResponse('', [['escalate', { name: 'Brian', reason: 'wants the owner' }]])
      ),
      capabilities,
      nameConfirmed: true,
      heldCallerName: 'Alvin',
      handlers: { escalate: async (e) => (heldNames.push(e.name), { ok: true, channel: 'whatsapp' }) },
    });
    const esc = withHeld.results.find((r) => r.action === 'escalate');
    assert.ok(esc);
    assert.equal(esc.status, 'succeeded');
    assert.deepEqual(heldNames, ['Alvin']);

    const sentNames = [];
    const noHeld = await executeBrainTools({
      parsed: mergeNativeFunctionCalls(
        parseGeminiResponse(''),
        fnResponse('', [['escalate', { name: 'Brian', reason: 'wants the owner' }]])
      ),
      capabilities,
      nameConfirmed: false,
      heldCallerName: '',
      handlers: { escalate: async (e) => (sentNames.push(e.name), { id: 'esc_2' }) },
    });
    assert.deepEqual(sentNames, []);
    assert.equal(noHeld.results.find((r) => r.action === 'escalate').status, 'invalid');
  });
});

describe('native calls map onto the marker shape', () => {
  it('create_appointment keeps landmark and when_text, and the outcome is not model prose', () => {
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse('Booked! {"create_appointment": {"when_text": "x"}}'),
      fnResponse('', [
        ['create_appointment', { service_name: 'Deep cleaning', when_text: 'kesho 10am', landmark: 'Kilimani' }],
      ])
    );
    assert.equal(parsed.appointment.serviceName, 'Deep cleaning');
    assert.equal(parsed.appointment.whenText, 'kesho 10am');
    assert.equal(parsed.appointment.landmark, 'Kilimani');
    assert.equal(parsed.appointment.name, '');
    assert.equal(parsed.holdSpeechUntilToolsClose, true);
    assert.equal(parsed.spokenText.includes('{'), false);
  });

  it('native wins over a marker for the same tool; markers fill gaps', () => {
    const text =
      'Okay. ###TOOL###{"create_service_request":{"type":"hold","item":"A"},"escalate":{"reason":"r"}}###ENDTOOL###';
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(text),
      fnResponse('', [['create_service_request', { type: 'enquiry', item: 'B' }]])
    );
    assert.equal(parsed.serviceRequest.item, 'B');
    assert.equal(parsed.serviceRequest.type, 'enquiry');
    assert.equal(parsed.escalate.reason, 'r');
    assert.equal(parsed.spokenText, 'Okay.');
  });

  it('end_call ends; unknown functions become invalid tool results', () => {
    const parsed = mergeNativeFunctionCalls(
      parseGeminiResponse(''),
      fnResponse('', [['end_call', {}], ['quote_price', { amount: '500' }]])
    );
    assert.equal(parsed.shouldEndCall, true);
    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.errors[0].type, 'unknown_function');
  });

  it('with no functionCall parts the parse is unchanged', () => {
    const base = parseGeminiResponse('Hello there.');
    const merged = mergeNativeFunctionCalls(base, fnResponse('Hello there.', []));
    assert.deepEqual(merged, base);
  });

  it('reads string args and stream part lists', () => {
    const calls = extractGeminiFunctionCalls([
      { text: 'x' },
      { functionCall: { name: 'save_caller_info', args: '{"reason":"r"}' } },
    ]);
    assert.deepEqual(calls, [{ name: 'save_caller_info', args: { reason: 'r' } }]);
    assert.equal(hasGeminiFunctionCall([{ text: 'x' }]), false);
  });

  it('scrubs markers and bare tool JSON from final speech', () => {
    assert.equal(
      stripToolTextForSpeech('Sawa. {"escalate": {"reason": "r"}} ###ENDCALL###'),
      'Sawa.'
    );
  });
});

describe('history replay', () => {
  it('stream parts keep the functionCall so the turn can parse it', () => {
    let acc = [];
    acc = appendGeminiStreamParts(acc, fnResponse('Sawa.', []));
    acc = appendGeminiStreamParts(acc, {
      candidates: [{ content: { parts: [{ functionCall: { name: 'end_call', args: {} }, thoughtSignature: 'sig' }] } }],
    });
    assert.equal(hasGeminiFunctionCall(acc), true);
    assert.equal(extractGeminiParts(fnResponse('', [['end_call', {}]])).length, 1);
  });

  it('drops functionCall parts before replay and skips a function-only turn', () => {
    const messages = [
      { role: 'user', content: 'Book kesho' },
      {
        role: 'assistant',
        content: 'Booked.',
        geminiParts: modelPartsForHistory({
          geminiParts: [{ functionCall: { name: 'create_appointment', args: {} }, thoughtSignature: 'sig' }],
        }),
      },
      { role: 'user', content: 'Thanks' },
      {
        role: 'assistant',
        content: 'Karibu.',
        geminiParts: [{ text: 'Karibu.', thoughtSignature: 's2' }, { functionCall: { name: 'end_call', args: {} } }],
      },
    ];
    const contents = buildGeminiContents(messages);
    const allParts = contents.flatMap((c) => c.parts);
    assert.equal(allParts.some((p) => p.functionCall), false);
    assert.deepEqual(contents.map((c) => c.role), ['user', 'model']);
    assert.equal(contents[0].parts[0].text, 'Book kesho Thanks');
    assert.equal(contents[1].parts[0].text, 'Karibu.');
  });
});

describe('server wiring (Brain-only footprint)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('adds the flagged tools inside geminiVoiceConfig only', () => {
    const fn = server.slice(server.indexOf('function geminiVoiceConfig('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /\.\.\.nativeFunctionToolsConfig\(\)/);
    assert.match(body, /withNativeFunctionsPrompt\(systemPrompt\)/);
    assert.doesNotMatch(body, /responseSchema|responseMimeType|responseJsonSchema/);
  });

  it('merges native calls right after both marker parses', () => {
    assert.match(
      server,
      /const parsed = parseGeminiResponse\(fullText \|\| buffer\.getRaw\(\)\);\n\s+Object\.assign\(parsed, mergeNativeFunctionCalls\(parsed, modelParts, \{ callSid \}\)\);/
    );
    assert.match(
      server,
      /const parsed = parseGeminiResponse\(outputText\);\n\s+Object\.assign\(parsed, mergeNativeFunctionCalls\(parsed, response, \{ callSid \}\)\);/
    );
  });
});
