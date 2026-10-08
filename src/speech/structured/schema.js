// Gemini response schema and request config for the structured voice reply.
//
// Property order is lang, intent, facts_used, say, tool, end_call. facts_used
// comes before say on purpose: each say[] sentence is checked against the
// facts it cites as soon as its string closes, before it reaches TTS.
// lang is a single-value enum: code locks the language before the request.

const { getLanguagePack } = require('./languages');

const STRUCTURED_PROMPT_ID = 'voice.structured';
const STRUCTURED_PROMPT_VERSION = '2026-10-08.1';

const INTENTS = [
  'services',
  'price',
  'coverage',
  'booking',
  'visit_lookup',
  'identity',
  'handoff',
  'complaint',
  'smalltalk',
  'other',
];
const FACT_KINDS = ['service', 'price', 'coverage', 'policy', 'hours', 'location', 'visit'];
const TOOL_NAMES = [
  'save_caller_info',
  'escalate',
  'create_service_request',
  'create_appointment',
  'update_appointment',
];
const MAX_SAY = 3;

/**
 * Gemini Schema (OpenAPI subset, config.responseSchema). minItems/maxItems are
 * int64 fields, which the API takes as strings.
 * @param {'en'|'sw'|'sheng'} locked
 */
function structuredResponseSchema(locked) {
  return {
    type: 'OBJECT',
    properties: {
      lang: { type: 'STRING', enum: [getLanguagePack(locked).code] },
      intent: { type: 'STRING', enum: INTENTS },
      facts_used: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING', enum: FACT_KINDS },
            id: { type: 'STRING' },
          },
          required: ['kind', 'id'],
          propertyOrdering: ['kind', 'id'],
        },
      },
      say: {
        type: 'ARRAY',
        minItems: '1',
        maxItems: String(MAX_SAY),
        items: { type: 'STRING' },
      },
      tool: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', enum: TOOL_NAMES },
          args_json: { type: 'STRING' },
        },
        required: ['name', 'args_json'],
        propertyOrdering: ['name', 'args_json'],
      },
      end_call: { type: 'BOOLEAN' },
    },
    required: ['lang', 'intent', 'facts_used', 'say'],
    propertyOrdering: ['lang', 'intent', 'facts_used', 'say', 'tool', 'end_call'],
  };
}

/** The output contract appended to the live system prompt on this path only. */
function outputContract(locked) {
  const pack = getLanguagePack(locked);
  return [
    'OUTPUT CONTRACT (this overrides any earlier formatting or marker instruction):',
    'Reply with one JSON object and nothing else.',
    `- lang: always "${pack.code}". ${pack.directive}`,
    `- intent: one of ${INTENTS.join(', ')}.`,
    '- facts_used: every business fact you state (service, price, coverage area, policy, hours, location, the caller\'s booking), cited as {kind, id} with the [id] from GROUNDED FACTS. Use [] when you state none. Never state a price, number or place that is not in GROUNDED FACTS or in the caller\'s own words.',
    `- say: 1 to ${MAX_SAY} complete spoken sentences, in the order they are spoken. Answer what the caller asked first. Plain spoken words only: no lists, markdown, symbols, labels or stage directions. At most one question in the whole reply, and only as the last item.`,
    '- tool: where earlier instructions say to append ###TOOL###{...}###ENDTOOL###, set tool.name to that JSON\'s top-level key (save_caller_info, escalate, create_service_request, create_appointment, update_appointment) and tool.args_json to that key\'s object as a JSON string. Leave tool out otherwise. Never write ###TOOL### or ###ENDCALL### inside say.',
    '- end_call: true only where earlier instructions say to append ###ENDCALL###.',
    '- Never say in say that something is booked, saved, sent or confirmed. The system confirms it after the tool runs.',
  ].join('\n');
}

/**
 * @param {string} systemPrompt the live turn prompt (unchanged legacy prompt)
 * @param {{ locked: string, factsBlock: string, env?: object }} opts
 */
function structuredGeminiConfig(systemPrompt, { locked, factsBlock, env = process.env } = {}) {
  const instruction = [String(systemPrompt || ''), factsBlock || '', outputContract(locked)]
    .filter(Boolean)
    .join('\n\n');
  return {
    systemInstruction: { parts: [{ text: instruction }] },
    temperature: Number(env.GEMINI_VOICE_TEMPERATURE || 0.35),
    maxOutputTokens: Number(env.GEMINI_STRUCTURED_MAX_OUTPUT_TOKENS || 512),
    thinkingConfig: { thinkingLevel: env.GEMINI_THINKING_LEVEL || 'MINIMAL' },
    responseMimeType: 'application/json',
    responseSchema: structuredResponseSchema(locked),
  };
}

/** One corrective user turn for the single regeneration. */
function correctionTurn(locked, problems) {
  const pack = getLanguagePack(locked);
  const why = (problems || [])
    .slice(0, 4)
    .map((p) => `${p.code}${p.detail ? ` (${p.detail})` : ''}${p.sentence ? `: "${p.sentence}"` : ''}`)
    .join('; ');
  return {
    role: 'user',
    parts: [
      {
        text: `[system correction, not the caller] Your last reply was not spoken because: ${why || 'it did not follow the OUTPUT CONTRACT'}. Reply again to the caller's last turn as one JSON object that follows the OUTPUT CONTRACT. lang must be "${pack.code}" and every say item must be in ${pack.name}. State only facts from GROUNDED FACTS and cite them.`,
      },
    ],
  };
}

module.exports = {
  STRUCTURED_PROMPT_ID,
  STRUCTURED_PROMPT_VERSION,
  INTENTS,
  FACT_KINDS,
  TOOL_NAMES,
  MAX_SAY,
  structuredResponseSchema,
  structuredGeminiConfig,
  outputContract,
  correctionTurn,
};
