const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  observeCallerTurn,
} = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { executeBrainTools } = require('../src/conversation/toolExecution');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { appointmentEvent, renderEventText } = require('../src/notifications/events');

const profile = {
  vertical: 'home_services',
  callerMemory: {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    greetByName: true,
    sharedLine: false,
  },
  servicesCatalog: [{ name: 'Carpet cleaning' }],
};

const CALL_NOW = new Date('2026-10-04T16:58:00+03:00');

function turn(state, text) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile,
    now: CALL_NOW,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

describe('failed Sunday booking replay', () => {
  it('keeps Alvin and saves Monday 5 October 2026, 9 AM after Ataround', async () => {
    let state = turn(
      createBrainState(profile),
      'I want to make a booking for tomorrow at Westlands, ABC, for carpet cleaning.'
    );
    assert.equal(state.caller.fileNameAsked, 'Alvin');
    state.caller.fileNameAskSpoken = true;

    state = turn(state, "Yes, you're speaking with Alvin.");
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);

    state = turn(state, 'Ataround');
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);
    assert.notEqual(state.entities?.name?.value, 'Ataround');

    state = turn(state, '9 is okay');
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);

    const parsed = parseGeminiResponse(
      'Monday at 9 AM. ###TOOL###{"save_caller_info":{"name":"Ataround","reason":"carpet cleaning"},"create_appointment":{"service_name":"Carpet cleaning","name":"Ataround","when_text":"tomorrow at 9 AM","location":"Westlands ABC","notes":"confirm access","window_start":"2026-10-05T06:00:56.000Z","window_end":"2026-10-05T06:00:56.000Z"}}###ENDTOOL###'
    );
    const saved = [];
    const callers = [];
    const execution = await executeBrainTools({
      parsed,
      capabilities: {
        createAppointment: true,
        saveCallerInfo: true,
        createServiceRequest: true,
        updateAppointment: true,
        escalate: true,
      },
      hoursSchedule: defaultHoursSchedule(),
      now: CALL_NOW,
      nameConfirmed: state.caller.nameConfirmed === true,
      heldCallerName: String(state.caller.name || '').trim(),
      handlers: {
        saveCallerInfo: async (info) => {
          callers.push(info);
          return info;
        },
        createAppointment: async (appointment) => {
          saved.push(appointment);
          return {
            id: 'appt_replay',
            status: 'requested',
            service_name: appointment.serviceName,
            when_text: appointment.whenText,
            caller_name: appointment.name,
            address_landmark: appointment.landmark,
            caller_phone: '+254790381872',
            notes: appointment.notes,
            window_start: appointment.windowStart || null,
            window_end: appointment.windowEnd || null,
          };
        },
      },
    });

    assert.equal(execution.results.find((row) => row.action === 'create_appointment').status, 'succeeded');
    assert.equal(callers.length, 1);
    assert.equal(callers[0].name, 'Alvin');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Alvin');
    assert.equal(saved[0].whenText, 'Monday 5 October 2026, 9 AM');
    assert.equal(saved[0].landmark, 'Westlands ABC');
    assert.equal(saved[0].serviceName, 'Carpet cleaning');
    assert.equal(saved[0].windowStart, '2026-10-05T06:00:00.000Z');
    assert.equal(saved[0].windowEnd, '2026-10-05T06:00:00.000Z');
    assert.equal(/tomorrow/i.test(saved[0].whenText), false);
    assert.equal(/Ataround/i.test(saved[0].name), false);

    const body = renderEventText(
      appointmentEvent(
        {
          service_name: saved[0].serviceName,
          when_text: saved[0].whenText,
          address_landmark: saved[0].landmark,
          caller_name: saved[0].name,
          caller_phone: '+254790381872',
          notes: saved[0].notes,
          status: 'requested',
        },
        'Done and Dusted'
      )
    );
    assert.match(body, /When: Monday 5 October 2026, 9 AM/);
    assert.match(body, /Caller: Alvin/);
    assert.match(body, /Where: Westlands ABC/);
    assert.doesNotMatch(body, /tomorrow/i);
    assert.doesNotMatch(body, /Ataround/);
  });

  it('saves tomorrow morning as the Nairobi day and period, with no clock window', async () => {
    const payloads = [];
    const parsed = parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Ataround","when_text":"tomorrow morning","location":"Westlands ABC","window_start":"2026-10-05T07:00:00.000Z","window_end":"2026-10-05T07:00:00.000Z"}}###ENDTOOL###'
    );
    const execution = await executeBrainTools({
      parsed,
      capabilities: { createAppointment: true, saveCallerInfo: true },
      hoursSchedule: defaultHoursSchedule(),
      now: CALL_NOW,
      nameConfirmed: true,
      heldCallerName: 'Alvin',
      handlers: {
        createAppointment: async (appointment) => {
          payloads.push(appointment);
          return { id: 'appt_morning', status: 'requested' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(payloads[0].name, 'Alvin');
    assert.equal(payloads[0].whenText, 'Monday 5 October 2026, morning');
    assert.equal(payloads[0].windowStart, '');
    assert.equal(payloads[0].windowEnd, '');
    assert.equal(payloads[0].landmark, 'Westlands ABC');
    assert.equal(/10:00|10 AM/.test(payloads[0].whenText), false);
  });
});
