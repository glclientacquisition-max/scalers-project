// Day-one Gemini native function declarations, behind BRAIN_NATIVE_FUNCTIONS.
//
// Flag off (default): nothing is declared, the model never returns a
// functionCall part, and ###TOOL### markers stay the only tool path.
// Flag on: the same tools are declared as functions. A functionCall part is
// mapped onto the exact parseGeminiResponse shape, so guardToolPlan,
// ensureRequired*, and executeBrainTools run unchanged.
//
// Locked rules this module enforces:
// - The caller name is a code-held phone-file fact. No declaration has a
//   name parameter. A name the model sends anyway is dropped. Tools carry
//   only the name code already holds (executeBrainTools heldCallerName).
// - Native calls win over markers for the same field; markers fill gaps.
// - Tool payload text is never speech. The parsed result carries
//   holdSpeechUntilToolsClose so Voice can bind it; this module does not
//   touch the stream buffer, PCM, generation, or stream ids.
// - No response JSON schema. functionDeclarations are tools, not a
//   responseSchema/responseMimeType on the spoken stream.

const { Type } = require('@google/genai');

const DAY_ONE_FUNCTION_NAMES = Object.freeze([
  'save_caller_info',
  'create_service_request',
  'create_appointment',
  'update_appointment',
  'escalate',
  'end_call',
]);

const NAME_KEYS = Object.freeze(['name', 'caller_name', 'callerName', 'full_name']);

const STRING = Object.freeze({ type: Type.STRING });

function nativeFunctionsEnabled(env = process.env) {
  const raw = String(env?.BRAIN_NATIVE_FUNCTIONS || '').trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

function str(description) {
  return description ? { ...STRING, description } : { ...STRING };
}

/**
 * @param {{ escalate?: boolean, endCall?: boolean }} [opts]
 */
function dayOneFunctionDeclarations({ escalate = true, endCall = true } = {}) {
  const declarations = [
    {
      name: 'save_caller_info',
      description:
        'Save the reason for the call. The backend attaches the caller name it already holds. Never pass a name. Do not invent visits.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          reason: str('Latest reason or need, in the caller\'s words.'),
        },
      },
    },
    {
      name: 'create_service_request',
      description:
        'Log a hold, order, enquiry, or callback. Speak nothing about the outcome; the backend confirms after the row is saved. Holds and orders only for listed catalogue items.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: str('hold | enquiry | order | callback'),
          item: str('Catalogue title or what they asked about. Never a price.'),
          quantity: str('Only a quantity the caller said.'),
          when_text: str('When, in the caller\'s words (for example "kesho 10am").'),
          notes: STRING,
        },
      },
    },
    {
      name: 'create_appointment',
      description:
        'Book a home-services visit once service, when, and place are known. Speak nothing about the outcome; the backend confirms after the row is saved.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          service_name: STRING,
          when_text: str('When, in the caller\'s words (for example "kesho 10am").'),
          landmark: str('Where we should come (area or place). Never say the word landmark aloud.'),
          notes: STRING,
        },
      },
    },
    {
      name: 'update_appointment',
      description:
        'Reschedule or cancel an open visit. Speak nothing about the outcome; the backend confirms.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          appointment_id: STRING,
          status: str('cancelled | requested'),
          when_text: STRING,
          landmark: STRING,
          service_name: STRING,
          notes: STRING,
        },
      },
    },
  ];

  if (escalate) {
    declarations.push({
      name: 'escalate',
      description:
        'Notify the team so a person calls back. The backend attaches the caller name it already holds. Never pass a name. Never claim a live transfer.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          teammate: str('Role or teammate they asked for, if any.'),
          reason: str('Why they need a person.'),
        },
      },
    });
  }

  if (endCall) {
    declarations.push({
      name: 'end_call',
      description: 'End the call after the goodbye.',
      parameters: { type: Type.OBJECT, properties: {} },
    });
  }

  return declarations;
}

/**
 * Extra Gemini config for the voice turn. Empty object when the flag is off,
 * so geminiVoiceConfig is byte-identical to main.
 */
function nativeFunctionToolsConfig({ env = process.env, escalate = true, endCall = true } = {}) {
  if (!nativeFunctionsEnabled(env)) return {};
  return {
    tools: [{ functionDeclarations: dayOneFunctionDeclarations({ escalate, endCall }) }],
  };
}

const NATIVE_FUNCTIONS_PROMPT_NOTE = [
  'TOOLS (do not read aloud):',
  '- Use the declared functions for save_caller_info, create_service_request, create_appointment, update_appointment, escalate, and end_call. Do not print ###TOOL### or JSON.',
  '- Never put a caller name in a function call. The backend holds the confirmed name.',
  '- On a function turn speak nothing about the outcome. The backend speaks it after the save.',
].join('\n');

function withNativeFunctionsPrompt(systemPrompt, env = process.env) {
  const base = String(systemPrompt || '');
  if (!nativeFunctionsEnabled(env)) return base;
  if (base.includes(NATIVE_FUNCTIONS_PROMPT_NOTE)) return base;
  return `${base}\n\n${NATIVE_FUNCTIONS_PROMPT_NOTE}`;
}

function normalizeFunctionCall(part) {
  const call = part?.functionCall || part?.function_call || null;
  if (!call || typeof call !== 'object') return null;
  const name = String(call.name || '').trim();
  if (!name) return null;
  let args = call.args ?? call.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  return { name, args };
}

/**
 * functionCall parts from a response, a stream chunk, or a parts list.
 */
function extractGeminiFunctionCalls(responseOrParts) {
  const parts = Array.isArray(responseOrParts)
    ? responseOrParts
    : responseOrParts?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const part of parts) {
    const call = normalizeFunctionCall(part);
    if (call) out.push(call);
  }
  return out;
}

/** True when a stream chunk or parts list carries a functionCall. Voice may bind this. */
function hasGeminiFunctionCall(responseOrParts) {
  return extractGeminiFunctionCalls(responseOrParts).length > 0;
}

function withoutNames(args) {
  const out = {};
  let droppedName = false;
  for (const [key, value] of Object.entries(args || {})) {
    if (NAME_KEYS.includes(key)) {
      if (String(value ?? '').trim()) droppedName = true;
      continue;
    }
    out[key] = value;
  }
  return { args: out, droppedName };
}

function s(value) {
  return String(value ?? '').trim();
}

/**
 * Map native calls onto the parseGeminiResponse shape. Name fields stay
 * empty: executeBrainTools stamps the code-held name.
 */
function parseFunctionCalls(calls) {
  const output = {
    name: null,
    reason: null,
    escalate: null,
    serviceRequest: null,
    appointment: null,
    appointmentUpdate: null,
    shouldEndCall: false,
    callerInfoRequested: false,
    droppedModelName: false,
    functionCalls: [],
    errors: [],
  };
  for (const call of Array.isArray(calls) ? calls : []) {
    const fn = s(call?.name);
    const { args, droppedName } = withoutNames(call?.args);
    if (droppedName) output.droppedModelName = true;
    output.functionCalls.push({ name: fn, args });
    if (!DAY_ONE_FUNCTION_NAMES.includes(fn)) {
      output.errors.push({ type: 'unknown_function', message: fn || 'missing name' });
      continue;
    }
    if (fn === 'save_caller_info') {
      output.callerInfoRequested = true;
      if (s(args.reason)) output.reason = s(args.reason);
    } else if (fn === 'escalate') {
      output.escalate = {
        teammate: s(args.teammate || args.to || args.role),
        name: '',
        reason: s(args.reason),
      };
    } else if (fn === 'create_service_request') {
      output.serviceRequest = {
        type: s(args.type || args.request_type) || 'enquiry',
        name: '',
        phone: '',
        item: s(args.item || args.product),
        quantity: s(args.quantity || args.qty),
        whenText: s(args.when_text || args.when || args.pickup),
        notes: s(args.notes || args.reason),
      };
      if (!output.reason) {
        const bits = [
          output.serviceRequest.type,
          output.serviceRequest.item,
          output.serviceRequest.whenText,
        ].filter(Boolean);
        if (bits.length) output.reason = bits.join(' — ');
      }
    } else if (fn === 'create_appointment') {
      output.appointment = {
        serviceName: s(args.service_name || args.service || args.item),
        name: '',
        phone: '',
        whenText: s(args.when_text || args.when || args.time_window),
        landmark: s(args.landmark || args.location || args.address_landmark || args.address),
        notes: s(args.notes || args.reason),
        windowStart: '',
        windowEnd: '',
      };
      if (!output.reason) {
        const bits = [
          'visit',
          output.appointment.serviceName,
          output.appointment.whenText,
          output.appointment.landmark,
        ].filter(Boolean);
        if (bits.length) output.reason = bits.join(' — ');
      }
    } else if (fn === 'update_appointment') {
      output.appointmentUpdate = {
        appointmentId: s(args.appointment_id || args.id),
        status: s(args.status),
        whenText: s(args.when_text || args.when || args.time_window),
        landmark: s(args.landmark || args.location || args.address_landmark || args.address),
        notes: s(args.notes || args.reason),
        serviceName: s(args.service_name || args.service),
        phone: '',
        windowStart: '',
        windowEnd: '',
      };
    } else if (fn === 'end_call') {
      output.shouldEndCall = true;
    }
  }
  return output;
}

const TOOL_FIELDS = Object.freeze([
  'escalate',
  'serviceRequest',
  'appointment',
  'appointmentUpdate',
]);

/**
 * Merge native functionCall parts into a parseGeminiResponse result.
 * Returns a new object; `parsed` is not mutated. With no functionCall parts
 * the result is a shallow copy of `parsed`, so the flag-off path keeps
 * main's behavior.
 *
 * @param {object} parsed parseGeminiResponse(text) output
 * @param {Array|object} responseOrParts Gemini response or model parts
 */
function mergeNativeFunctionCalls(parsed, responseOrParts, { callSid = '' } = {}) {
  const base = parsed && typeof parsed === 'object' ? parsed : {};
  const calls = extractGeminiFunctionCalls(responseOrParts);
  if (!calls.length) return { ...base };
  const fromFns = parseFunctionCalls(calls);
  const merged = { ...base };
  for (const key of TOOL_FIELDS) {
    if (fromFns[key] != null) merged[key] = fromFns[key];
  }
  if (fromFns.callerInfoRequested) {
    merged.callerInfoRequested = true;
    // The model may not pick the name. A marker name from the same turn is
    // dropped too; executeBrainTools fills the code-held name.
    merged.name = null;
  }
  if (fromFns.reason != null) merged.reason = fromFns.reason;
  if (fromFns.shouldEndCall) merged.shouldEndCall = true;
  merged.errors = [...(Array.isArray(base.errors) ? base.errors : []), ...fromFns.errors];
  merged.functionCalls = fromFns.functionCalls;
  merged.droppedModelName = Boolean(base.droppedModelName || fromFns.droppedModelName);
  merged.holdSpeechUntilToolsClose = true;
  merged.nativeFunctionCalls = calls.length;
  merged.spokenText = stripToolTextForSpeech(base.spokenText);
  if (callSid) {
    console.log(
      `[${callSid}] native functions: ${calls.map((c) => c.name).join(',')}` +
        (merged.droppedModelName ? ' (model name dropped; code-held name only)' : '')
    );
  }
  return merged;
}

const BARE_TOOL_JSON =
  /\{\s*"(?:save_caller_info|create_service_request|create_appointment|update_appointment|escalate|end_call)"\s*:[\s\S]*?\}\s*\}?/g;

/** Final-text scrub: markers and bare function-shaped JSON are never speech. */
function stripToolTextForSpeech(text) {
  let out = String(text || '');
  out = out.replace(/###TOOL###[\s\S]*?###ENDTOOL###/gi, '');
  out = out.replace(/###TOOL###[\s\S]*$/i, '');
  out = out.replace(/###ENDTOOL###|###ENDCALL###/gi, '');
  out = out.replace(BARE_TOOL_JSON, '');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * History replay: we run tools ourselves and never send a functionResponse,
 * so a replayed functionCall part would be an unanswered call. Drop those
 * parts (with their signature) from model history.
 */
function dropFunctionCallParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.filter((part) => !(part && (part.functionCall || part.function_call)));
}

module.exports = {
  DAY_ONE_FUNCTION_NAMES,
  NATIVE_FUNCTIONS_PROMPT_NOTE,
  dayOneFunctionDeclarations,
  dropFunctionCallParts,
  extractGeminiFunctionCalls,
  hasGeminiFunctionCall,
  mergeNativeFunctionCalls,
  nativeFunctionToolsConfig,
  nativeFunctionsEnabled,
  parseFunctionCalls,
  stripToolTextForSpeech,
  withNativeFunctionsPrompt,
};
