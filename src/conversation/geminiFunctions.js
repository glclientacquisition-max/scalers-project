// Day-one Gemini native function declarations and parsers.
// Maps functionCall parts onto the same shape as parseGeminiResponse so
// executeBrainTools / injectors stay unchanged. Marker text still maps here
// when the model leaks ###TOOL### or raw JSON; that text is never spoken.

const { Type } = require('@google/genai');
const { parseGeminiResponse } = require('./toolMarkers');

const DAY_ONE_FUNCTION_NAMES = Object.freeze([
  'save_caller_info',
  'create_service_request',
  'create_appointment',
  'update_appointment',
  'escalate',
  'end_call',
]);

const STRING = { type: Type.STRING };

function dayOneFunctionDeclarations({ escalate = true, endCall = true } = {}) {
  /** @type {import('@google/genai').FunctionDeclaration[]} */
  const declarations = [
    {
      name: 'save_caller_info',
      description:
        'Save the confirmed caller name and reason. Call after CALL STATE shows the name is confirmed, or when they just corrected it. Do not invent visits.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { ...STRING, description: 'Confirmed caller name spelling.' },
          reason: { ...STRING, description: 'Latest reason or need, if known.' },
        },
      },
    },
    {
      name: 'create_service_request',
      description:
        'Log a hold, pickup, order, enquiry, or callback. Speak nothing; the backend confirms.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: {
            ...STRING,
            description: 'hold | enquiry | order | callback',
          },
          name: STRING,
          phone: STRING,
          item: STRING,
          quantity: STRING,
          when_text: STRING,
          notes: STRING,
        },
      },
    },
    {
      name: 'create_appointment',
      description:
        'Book a home-services visit when service_name, name, when_text, and landmark are known. Speak nothing. Field landmark is where we should come — never say the word landmark aloud.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          service_name: STRING,
          name: STRING,
          phone: STRING,
          when_text: STRING,
          landmark: {
            ...STRING,
            description: 'Where we should come (area / place). Ask "Where should we come?"',
          },
          notes: STRING,
          window_start: STRING,
          window_end: STRING,
        },
      },
    },
    {
      name: 'update_appointment',
      description:
        'Reschedule or cancel a visit. Speak nothing; the backend confirms.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: STRING,
          appointment_id: STRING,
          status: { ...STRING, description: 'cancelled | requested' },
          when_text: STRING,
          landmark: STRING,
          notes: STRING,
          service_name: STRING,
          phone: STRING,
          window_start: STRING,
          window_end: STRING,
        },
      },
    },
  ];

  if (escalate) {
    declarations.push({
      name: 'escalate',
      description:
        'Notify a human / teammate. Speak nothing unless live connect is in progress.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          teammate: STRING,
          name: STRING,
          reason: STRING,
        },
      },
    });
  }

  if (endCall) {
    declarations.push({
      name: 'end_call',
      description: 'End the call after goodbye.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    });
  }

  return declarations;
}

function geminiToolsConfig({ escalate = true, endCall = true } = {}) {
  return {
    tools: [
      {
        functionDeclarations: dayOneFunctionDeclarations({ escalate, endCall }),
      },
    ],
  };
}

function emptyParsed(spokenText = '') {
  return {
    spokenText: String(spokenText || ''),
    shouldEndCall: false,
    name: null,
    reason: null,
    escalate: null,
    serviceRequest: null,
    appointment: null,
    appointmentUpdate: null,
    errors: [],
    functionCalls: [],
    holdSpeechUntilToolsClose: false,
  };
}

function applyFunctionArgs(output, name, args) {
  const raw = args && typeof args === 'object' ? args : {};
  if (name === 'save_caller_info') {
    if (raw.name != null) output.name = raw.name;
    if (raw.reason != null) output.reason = raw.reason;
    return;
  }
  if (name === 'escalate') {
    output.escalate = {
      teammate: String(raw.teammate || raw.to || raw.role || '').trim(),
      name: String(raw.name || '').trim(),
      reason: String(raw.reason || '').trim(),
    };
    return;
  }
  if (name === 'create_service_request') {
    output.serviceRequest = {
      type: String(raw.type || raw.request_type || 'enquiry').trim(),
      name: String(raw.name || '').trim(),
      phone: String(raw.phone || '').trim(),
      item: String(raw.item || raw.product || '').trim(),
      quantity: String(raw.quantity || raw.qty || '').trim(),
      whenText: String(raw.when_text || raw.when || raw.pickup || '').trim(),
      notes: String(raw.notes || raw.reason || '').trim(),
    };
    if (!output.name && output.serviceRequest.name) {
      output.name = output.serviceRequest.name;
    }
    if (!output.reason) {
      const bits = [
        output.serviceRequest.type,
        output.serviceRequest.item,
        output.serviceRequest.whenText,
      ].filter(Boolean);
      if (bits.length) output.reason = bits.join(' — ');
    }
    return;
  }
  if (name === 'create_appointment') {
    output.appointment = {
      serviceName: String(raw.service_name || raw.service || raw.item || '').trim(),
      name: String(raw.name || '').trim(),
      phone: String(raw.phone || '').trim(),
      whenText: String(raw.when_text || raw.when || raw.time_window || '').trim(),
      landmark: String(
        raw.landmark || raw.location || raw.address_landmark || raw.address || ''
      ).trim(),
      notes: String(raw.notes || raw.reason || '').trim(),
      windowStart: String(raw.window_start || '').trim(),
      windowEnd: String(raw.window_end || '').trim(),
    };
    if (!output.name && output.appointment.name) {
      output.name = output.appointment.name;
    }
    if (!output.reason) {
      const bits = [
        'visit',
        output.appointment.serviceName,
        output.appointment.whenText,
        output.appointment.landmark,
      ].filter(Boolean);
      if (bits.length) output.reason = bits.join(' — ');
    }
    return;
  }
  if (name === 'update_appointment') {
    output.appointmentUpdate = {
      appointmentId: String(raw.id || raw.appointment_id || '').trim(),
      status: String(raw.status || '').trim(),
      whenText: String(raw.when_text || raw.when || raw.time_window || '').trim(),
      landmark: String(
        raw.landmark || raw.location || raw.address_landmark || raw.address || ''
      ).trim(),
      notes: String(raw.notes || raw.reason || '').trim(),
      serviceName: String(raw.service_name || raw.service || '').trim(),
      phone: String(raw.phone || '').trim(),
      windowStart: String(raw.window_start || '').trim(),
      windowEnd: String(raw.window_end || '').trim(),
    };
    return;
  }
  if (name === 'end_call') {
    output.shouldEndCall = true;
  }
}

function normalizeFunctionCall(part) {
  const call = part?.functionCall || part?.function_call || null;
  if (!call || typeof call !== 'object') return null;
  const name = String(call.name || '').trim();
  if (!name) return null;
  let args = call.args || call.arguments || {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  if (!args || typeof args !== 'object') args = {};
  return { name, args };
}

/**
 * Extract native functionCall parts from a Gemini response or stream parts list.
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

function parseFunctionCalls(calls) {
  const output = emptyParsed('');
  const list = Array.isArray(calls) ? calls : [];
  output.functionCalls = list;
  if (list.length) output.holdSpeechUntilToolsClose = true;
  for (const call of list) {
    const name = String(call?.name || '').trim();
    if (!DAY_ONE_FUNCTION_NAMES.includes(name)) {
      output.errors.push({
        type: 'unknown_function',
        message: name || 'missing name',
      });
      continue;
    }
    applyFunctionArgs(output, name, call.args || {});
  }
  return output;
}

/**
 * Prefer native function calls. Fall back to ###TOOL### / ###ENDCALL### /
 * bare JSON tool payloads. Marker / JSON text is stripped from spokenText.
 */
function parseGeminiTools({ text = '', functionCalls = [], geminiParts = [] } = {}) {
  const calls =
    Array.isArray(functionCalls) && functionCalls.length
      ? functionCalls
      : extractGeminiFunctionCalls(geminiParts);
  const fromFns = parseFunctionCalls(calls);
  const fromMarkers = parseGeminiResponse(String(text || ''));
  const rawJson = parseBareToolJson(String(text || ''));

  const merged = emptyParsed(fromMarkers.spokenText);
  merged.errors = [
    ...(fromFns.errors || []),
    ...(fromMarkers.errors || []),
    ...(rawJson.errors || []),
  ];
  merged.functionCalls = fromFns.functionCalls;
  merged.holdSpeechUntilToolsClose = Boolean(
    fromFns.holdSpeechUntilToolsClose ||
      fromMarkers.spokenText !== String(text || '').trim() ||
      rawJson.matched ||
      /###TOOL###|###ENDCALL###/i.test(String(text || ''))
  );

  // Native calls win; markers / bare JSON fill gaps only.
  for (const key of [
    'name',
    'reason',
    'escalate',
    'serviceRequest',
    'appointment',
    'appointmentUpdate',
  ]) {
    merged[key] =
      fromFns[key] != null
        ? fromFns[key]
        : fromMarkers[key] != null
          ? fromMarkers[key]
          : rawJson[key] != null
            ? rawJson[key]
            : null;
  }
  merged.shouldEndCall = Boolean(
    fromFns.shouldEndCall || fromMarkers.shouldEndCall || rawJson.shouldEndCall
  );

  // Never leave tool JSON or markers in what may be spoken.
  merged.spokenText = stripToolTextForSpeech(merged.spokenText);
  if (merged.holdSpeechUntilToolsClose && hasActionTool(merged)) {
    // Outcome tools and save_caller_info: model prose must not race the code line.
    if (
      merged.escalate ||
      merged.serviceRequest ||
      merged.appointment ||
      merged.appointmentUpdate ||
      merged.name != null ||
      merged.reason != null
    ) {
      // Keep spokenText only when no action tool — save may still need silence.
    }
  }
  return merged;
}

function hasActionTool(parsed) {
  return Boolean(
    parsed?.escalate ||
      parsed?.serviceRequest ||
      parsed?.appointment ||
      parsed?.appointmentUpdate ||
      parsed?.name != null ||
      parsed?.reason != null ||
      parsed?.shouldEndCall
  );
}

function stripToolTextForSpeech(text) {
  let s = String(text || '');
  s = s.replace(/###TOOL###[\s\S]*?###ENDTOOL###/gi, '');
  s = s.replace(/###TOOL###[\s\S]*$/i, '');
  s = s.replace(/###ENDTOOL###/gi, '');
  s = s.replace(/###ENDCALL###/gi, '');
  // Bare function-shaped JSON the model printed as text.
  s = s.replace(
    /\{\s*"(?:save_caller_info|create_service_request|create_appointment|update_appointment|escalate|end_call)"\s*:[\s\S]*?\}\s*/g,
    ''
  );
  return s.replace(/\s+/g, ' ').trim();
}

function parseBareToolJson(text) {
  const output = emptyParsed('');
  const raw = String(text || '');
  const re =
    /\{\s*"(save_caller_info|create_service_request|create_appointment|update_appointment|escalate|end_call)"\s*:/g;
  let match;
  const seen = new Set();
  while ((match = re.exec(raw)) !== null) {
    const start = match.index;
    const slice = raw.slice(start);
    const end = findMatchingBrace(slice);
    if (end < 0) continue;
    const jsonText = slice.slice(0, end + 1);
    if (seen.has(jsonText)) continue;
    seen.add(jsonText);
    try {
      const parsed = JSON.parse(jsonText);
      for (const name of DAY_ONE_FUNCTION_NAMES) {
        if (parsed[name] != null) {
          output.matched = true;
          if (name === 'end_call') {
            applyFunctionArgs(output, name, {});
          } else {
            applyFunctionArgs(output, name, parsed[name]);
          }
        }
      }
    } catch (err) {
      output.errors.push({
        type: 'invalid_bare_tool_json',
        message: String(err?.message || err),
      });
    }
  }
  return output;
}

function findMatchingBrace(text) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

module.exports = {
  DAY_ONE_FUNCTION_NAMES,
  dayOneFunctionDeclarations,
  extractGeminiFunctionCalls,
  geminiToolsConfig,
  parseFunctionCalls,
  parseGeminiTools,
  stripToolTextForSpeech,
};
