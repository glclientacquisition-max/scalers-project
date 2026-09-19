const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureRequiredCreateRequest,
  formatCreateRequestDirective,
} = require('../src/conversation/requiredCreateRequest');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');

const HOME_CAPS = {
  createAppointment: true,
  updateAppointment: true,
  createServiceRequest: true,
};

const RETAIL_CAPS = {
  createServiceRequest: true,
  createAppointment: true,
};

function homeBookingState(overrides = {}) {
  return {
    vertical: 'home_services',
    intent: 'booking',
    resolution: { nextBestAction: 'CREATE_REQUEST' },
    caller: { name: 'Amina', phone: '+254700000001', nameConfirmed: true },
    entities: {
      service: { value: 'Carpet cleaning' },
      name: { value: 'Amina' },
      when: { value: 'Saturday 9 to 11' },
      landmark: { value: 'Barnabas' },
    },
    goal: {
      missingSlots: [],
      description: 'carpet clean Saturday at Barnabas',
    },
    ...overrides,
  };
}

function retailHoldState(overrides = {}) {
  return {
    vertical: 'retail',
    intent: 'hold',
    resolution: { nextBestAction: 'CREATE_REQUEST' },
    caller: { name: 'Brian', phone: '+254700000002', nameConfirmed: true },
    entities: {
      product: { value: 'Atomic Habits' },
      name: { value: 'Brian' },
      when: { value: 'Friday 5' },
    },
    goal: {
      missingSlots: [],
      description: 'hold Atomic Habits for Friday 5',
    },
    ...overrides,
  };
}

describe('required create-request injection', () => {
  it('injects create_appointment when home visit slots are complete and the model omitted the marker', () => {
    const parsed = ensureRequiredCreateRequest(
      { spokenText: "You're booked Saturday.", appointment: null },
      homeBookingState(),
      HOME_CAPS
    );
    assert.equal(parsed.appointment.name, 'Amina');
    assert.equal(parsed.appointment.serviceName, 'Carpet cleaning');
    assert.equal(parsed.appointment.whenText, 'Saturday 9 to 11');
    assert.equal(parsed.appointment.landmark, 'Barnabas');
  });

  it('injects create_service_request when retail hold slots are complete and the model omitted the marker', () => {
    const parsed = ensureRequiredCreateRequest(
      { spokenText: "I'll put it aside.", serviceRequest: null },
      retailHoldState(),
      RETAIL_CAPS
    );
    assert.equal(parsed.serviceRequest.type, 'hold');
    assert.equal(parsed.serviceRequest.name, 'Brian');
    assert.equal(parsed.serviceRequest.item, 'Atomic Habits');
    assert.equal(parsed.serviceRequest.whenText, 'Friday 5');
  });

  it('does not override an existing appointment marker', () => {
    const parsed = ensureRequiredCreateRequest(
      {
        appointment: {
          serviceName: 'Plumbing',
          name: 'Amina',
          whenText: 'Tuesday 10 AM',
          landmark: 'Westlands',
        },
      },
      homeBookingState(),
      HOME_CAPS
    );
    assert.equal(parsed.appointment.serviceName, 'Plumbing');
    assert.equal(parsed.appointment.whenText, 'Tuesday 10 AM');
  });

  it('does not inject when slots are still missing', () => {
    const parsed = ensureRequiredCreateRequest(
      { appointment: null },
      homeBookingState({
        goal: { missingSlots: ['landmark'], description: 'carpet clean' },
        entities: {
          service: { value: 'Carpet cleaning' },
          name: { value: 'Amina' },
          when: { value: 'Saturday 9 to 11' },
        },
      }),
      HOME_CAPS
    );
    assert.equal(parsed.appointment, null);
  });

  it('does not inject when NBA is ANSWER', () => {
    const parsed = ensureRequiredCreateRequest(
      { appointment: null },
      homeBookingState({
        intent: 'hours',
        resolution: { nextBestAction: 'ANSWER' },
      }),
      HOME_CAPS
    );
    assert.equal(parsed.appointment, null);
  });

  it('skips injection when createAppointment is disabled', () => {
    const parsed = ensureRequiredCreateRequest(
      { appointment: null },
      homeBookingState(),
      { createAppointment: false }
    );
    assert.equal(parsed.appointment, null);
  });

  it('injects update_appointment for a home cancellation', () => {
    const parsed = ensureRequiredCreateRequest(
      { appointmentUpdate: null },
      homeBookingState({
        intent: 'cancellation',
        goal: { missingSlots: [], description: 'please cancel my visit' },
        entities: { reference: { value: 'open visit Carpet cleaning, Saturday' } },
      }),
      HOME_CAPS
    );
    assert.equal(parsed.appointmentUpdate.status, 'cancelled');
    assert.equal(parsed.appointment, undefined);
  });

  it('formats a hard turn directive when a save is due', () => {
    const block = formatCreateRequestDirective(homeBookingState());
    assert.match(block, /REQUIRED ACTION THIS TURN/i);
    assert.match(block, /create_appointment/);
    assert.match(block, /speak nothing/i);
  });

  it('executes the injected visit and speaks the backend confirmation, not the model promise', async () => {
    const parsed = ensureRequiredCreateRequest(
      { spokenText: "You're booked Tuesday." },
      homeBookingState({
        entities: {
          service: { value: 'Carpet cleaning' },
          name: { value: 'Amina' },
          when: { value: 'Tuesday 10 AM' },
          landmark: { value: 'Barnabas' },
        },
      }),
      HOME_CAPS
    );
    let created = null;
    const execution = await executeBrainTools({
      parsed,
      capabilities: HOME_CAPS,
      nameConfirmed: true,
      hoursSchedule: defaultHoursSchedule(),
      handlers: {
        createAppointment: async (value) => {
          created = value;
          return { id: 'appt-1', status: 'requested', service_name: value.serviceName };
        },
      },
    });
    assert.ok(created);
    assert.equal(created.name, 'Amina');
    const result = execution.results.find((row) => row.action === 'create_appointment');
    assert.equal(result.status, 'succeeded');
    const spoken = formatToolConfirmation(execution.results, 'en');
    assert.match(spoken, /saved your visit request/i);
    assert.doesNotMatch(spoken, /booked/i);
  });

  it('does not insert a hold when the injected title is not in the catalogue', async () => {
    const parsed = ensureRequiredCreateRequest(
      { spokenText: "I'll put it aside." },
      retailHoldState({
        entities: {
          product: { value: 'I have to make habits' },
          name: { value: 'Brian' },
          when: { value: 'Friday 5' },
        },
      }),
      RETAIL_CAPS
    );
    let created = false;
    const execution = await executeBrainTools({
      parsed,
      capabilities: RETAIL_CAPS,
      productCatalog: [{ name: 'Atomic Habits', category: 'Self Help' }],
      handlers: {
        createServiceRequest: async () => {
          created = true;
          return { id: 'req-1', request_type: 'hold' };
        },
      },
    });
    assert.equal(created, false);
    const result = execution.results.find((row) => row.action === 'create_service_request');
    assert.equal(result.status, 'invalid');
  });
});
