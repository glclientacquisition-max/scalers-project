#!/usr/bin/env node
// One-person voice smoke: greeting, operational save/handoff, Gemini-down recovery.
// No network. Confirms canned speech stays one receptionist.

const assert = require('assert');
const { composeBusinessAssistantIntro } = require('../src/conversation/businessAssistantIntro');
const {
  pickActionProgress,
  pickClarifyProgress,
  pickContextualAck,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
  llmRecoveryEscalation,
} = require('../src/conversation/dynamicSpeech');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { CONVERSATION_RULES } = require('../src/prompts');

const TENANT = {
  businessName: 'Done and Dusted Cleaning Services',
  agentName: 'Shy',
  now: new Date('2026-08-13T10:00:00.000Z'),
};

const EN_MIDCALL =
  /^(Okay|Alright|Mm-hmm|I |I've |I'll |I'm |I'|We're |Tell |What |Please )/i;

function fail(label, detail) {
  console.error(`✗ ${label}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function checkLine(label, line, opts = {}) {
  const text = String(line || '').trim();
  if (!text) fail(label, 'empty spoken line');
  if (/[—–]/.test(text)) fail(label, `em/en dash: ${text}`);
  if (/\bcannot\b/i.test(text)) fail(label, `formal cannot: ${text}`);
  if (/on this line|technical issue/i.test(text)) fail(label, `system wording: ${text}`);
  if (!opts.allowLong && text.split(/\s+/).length > 25) {
    fail(label, `over 25 words: ${text}`);
  }
  if (opts.enMidCall && !EN_MIDCALL.test(text)) {
    fail(label, `not receptionist mid-call register: ${text}`);
  }
  if (opts.mustInclude) {
    for (const re of opts.mustInclude) {
      if (!re.test(text)) fail(label, `missing ${re}: ${text}`);
    }
  }
  console.log(`✓ ${label}: ${text}`);
  return text;
}

async function smokeOperationalBooking() {
  const greeting = composeBusinessAssistantIntro({
    ...TENANT,
    variant: 0,
    isOpen: true,
    servicesCatalog: [{ name: 'Carpet cleaning' }, { name: 'Couch cleaning' }],
  });
  checkLine('operational greeting', greeting, {
    allowLong: true,
    mustInclude: [/you've reached Done and Dusted/i, /this is Shy/i, /How can I help/i],
  });

  const progress = pickActionProgress('CREATE_REQUEST', 'en');
  checkLine('operational save progress', progress, {
    enMidCall: true,
    mustInclude: [/^Okay,/],
  });

  const execution = await executeBrainTools({
    parsed: parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Alvin","when_text":"Tuesday 10 AM","landmark":"Westlands"}}###ENDTOOL###'
    ),
    capabilities: {
      createAppointment: true,
      updateAppointment: true,
      createServiceRequest: true,
      saveCallerInfo: true,
      escalate: true,
      endCall: true,
    },
    hoursSchedule: defaultHoursSchedule(),
    now: new Date(Date.UTC(2026, 7, 18, 8, 0, 0)),
    handlers: {
      createAppointment: async (appointment) => ({
        id: 'appt_ok',
        service_name: appointment.serviceName,
        status: 'requested',
      }),
    },
  });
  const saved = formatToolConfirmation(execution.results, 'en');
  checkLine('operational visit saved', saved, {
    enMidCall: true,
    mustInclude: [/^Okay, I've saved your visit request/i, /Tuesday/i],
  });
  assert.equal(execution.results[0].status, 'succeeded');

  const hold = formatToolConfirmation(
    [{ action: 'create_service_request', status: 'succeeded' }],
    'en'
  );
  checkLine('operational request saved', hold, {
    enMidCall: true,
    mustInclude: [/^Okay, I've saved your request/],
  });

  const escalateProgress = pickActionProgress('ESCALATE', 'en');
  checkLine('operational escalate progress', escalateProgress, {
    enMidCall: true,
    mustInclude: [/^Okay, let me/],
  });

  const escalateConfirm = formatToolConfirmation(
    [{ action: 'escalate', status: 'succeeded', soft: true, channel: 'desk_note' }],
    'en'
  );
  checkLine('operational escalate noted', escalateConfirm, {
    enMidCall: true,
    mustInclude: [/^Okay, I've noted/],
  });

  const handoff = pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  });
  checkLine('operational handoff name', handoff, {
    enMidCall: true,
    mustInclude: [/May I have your name so I can reach them/],
  });

  const ack = pickContextualAck('I would like to book carpet cleaning', 'en');
  checkLine('operational ack', ack, { enMidCall: true });

  const openers = [progress, saved, hold, escalateProgress, escalateConfirm, handoff];
  const okayFamily = openers.filter((line) => /^Okay/i.test(line));
  if (okayFamily.length !== openers.length) {
    fail('operational one person', `expected Okay family on mid-call lines: ${openers.join(' | ')}`);
  }
  console.log('✓ operational booking path stays one person');
}

function smokeGeminiRules() {
  if (!/same person after the greeting/i.test(CONVERSATION_RULES)) {
    fail('gemini rules', 'CONVERSATION_RULES missing same-person register');
  }
  if (!/Kenyan receptionist/i.test(CONVERSATION_RULES)) {
    fail('gemini rules', 'CONVERSATION_RULES missing receptionist voice');
  }
  console.log('✓ Gemini rules keep the same person when the model is up');
}

function smokeRecoveryStillMatches() {
  const payload = llmRecoveryEscalation('Alvin');
  assert.equal(payload.name, 'Alvin');
  assert.match(payload.reason, /callback/i);
  assert.equal(payload.teammate, '');
  console.log('✓ recovery name enters escalation as a callback');

  const handoff = pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  });
  const recovery = pickLlmRecoveryLine({ language: 'en' });
  const saved = pickLlmRecoverySaved({ language: 'en' });
  checkLine('recovery offer', recovery, {
    enMidCall: true,
    mustInclude: [/May I have your name so I can reach them/],
  });
  checkLine('recovery saved', saved, { enMidCall: true, mustInclude: [/^Okay,/] });
  const nameAsk = handoff.replace(/^Okay\.\s*/, '');
  if (!recovery.includes(nameAsk)) {
    fail('recovery matches handoff', { handoff, recovery });
  }
  console.log('✓ Gemini-down recovery still uses the handoff name ask');
}

async function main() {
  smokeGeminiRules();
  await smokeOperationalBooking();
  smokeRecoveryStillMatches();
  console.log('\nOne-person voice smoke passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
