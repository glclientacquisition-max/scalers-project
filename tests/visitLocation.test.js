const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const {
  classifyVisitLocation,
  assessCoverage,
  decideVisitPlace,
  preferVisitPlace,
  visitBlockSpeech,
  coverageAskSpeech,
} = require('../src/conversation/visitLocation');
const { formatPlaybookForPrompt } = require('../src/conversation/playbooks');

const capabilities = {
  createAppointment: true,
  updateAppointment: true,
};

const now = new Date(Date.UTC(2026, 7, 18, 8, 0, 0));

describe('visit location ladder', () => {
  it('classifies area, findable detail, and a refusal', () => {
    assert.equal(classifyVisitLocation('Runda'), 'area_only');
    assert.equal(classifyVisitLocation('near Two Rivers, Runda'), 'findable');
    assert.equal(classifyVisitLocation('Green Park gate'), 'findable');
    assert.equal(classifyVisitLocation("You'll find it"), 'refused');
    assert.equal(classifyVisitLocation("I'll WhatsApp the pin"), 'empty');
    assert.equal(classifyVisitLocation('Westlands, I will share a pin'), 'pin_promised');
  });

  it('matches coverage from policies and location coverage notes, not shop landmarks', () => {
    const profile = {
      businessPolicies: { delivery: 'Westlands and Kilimani' },
      businessLocations: [
        { label: 'Depot', landmark: 'Kericho mall', coverage_notes: 'Karen' },
      ],
    };
    assert.equal(assessCoverage('Kilimani', profile), 'inside');
    assert.equal(assessCoverage('Karen, house 4', profile), 'inside');
    assert.equal(assessCoverage('Kericho', profile), 'outside');
    assert.equal(
      assessCoverage('Kericho', { businessPolicies: { delivery: 'Nairobi' } }),
      'outside'
    );
    assert.equal(assessCoverage('Runda', { businessPolicies: {} }), 'unknown');
  });

  it('keeps a gate when the caller only adds the city', () => {
    const prior = 'Runda Green Park gate 4';
    assert.equal(
      preferVisitPlace(prior, 'Nairobi', 'Runda is in Nairobi'),
      prior
    );
    assert.equal(preferVisitPlace(prior, 'Karen', "I'm in Karen"), 'Karen');
    assert.match(
      preferVisitPlace(prior, 'Karen gate 2', 'not Runda, Karen gate 2'),
      /Karen gate 2/
    );
  });

  it('answers a coverage question from settings text', () => {
    const profile = {
      vertical: 'home_services',
      businessPolicies: { delivery: 'Nairobi and Westlands' },
    };
    assert.match(
      coverageAskSpeech('Do you guys— do you guys do Rongai?', profile, 'en'),
      /outside our coverage/i
    );
    assert.match(
      coverageAskSpeech('What about Westlands?', profile, 'en'),
      /Yes, we cover Westlands/i
    );
    assert.equal(coverageAskSpeech('Do you do carpet cleaning?', profile, 'en'), '');
    assert.equal(coverageAskSpeech('Which team?', profile, 'en'), '');
    assert.equal(
      coverageAskSpeech('What about Rongai?', { vertical: 'retail', businessPolicies: { delivery: 'Nairobi' } }, 'en'),
      ''
    );
  });

  it('speaks the fixed outside line', () => {
    assert.match(visitBlockSpeech('outside', 'en'), /outside our coverage/i);
    assert.match(visitBlockSpeech('outside', 'sw'), /nje/i);
    assert.equal(visitBlockSpeech('refused', 'en'), '');
  });

  it('soft-saves area-only only after one follow-up when coverage matches', () => {
    const profile = { businessPolicies: { delivery: 'Runda, Karen' } };
    const first = decideVisitPlace('Runda', { profile, detailAsked: false });
    assert.equal(first.ask, true);
    assert.equal(first.bookable, false);
    const second = decideVisitPlace('Runda', { profile, detailAsked: true });
    assert.equal(second.bookable, true);
    assert.equal(second.confirmAccess, true);
    const outside = decideVisitPlace('Kericho', { profile, detailAsked: true });
    assert.equal(outside.bookable, false);
    assert.equal(outside.blocked, 'outside');
    const unknown = decideVisitPlace('Runda', { profile: {}, detailAsked: true });
    assert.equal(unknown.blocked, 'unknown_coverage');
    assert.equal(unknown.bookable, false);
  });

  it('stores a location alias on the existing landmark field', async () => {
    let saved = null;
    const execution = await executeBrainTools({
      parsed: parseGeminiResponse(
        '###TOOL###{"create_appointment":{"service_name":"Home cleaning","name":"Amina","when_text":"Tuesday 10 AM","location":"near Sarit Centre"}}###ENDTOOL###'
      ),
      capabilities,
      hoursSchedule: defaultHoursSchedule(),
      now,
      handlers: {
        createAppointment: async (appointment) => {
          saved = appointment;
          return { id: 'appt_loc', status: 'requested' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.landmark, 'near Sarit Centre');
    assert.doesNotMatch(formatToolConfirmation(execution.results, 'en'), /landmark/i);
  });

  it('rejects an outside area and does not insert a visit', async () => {
    let calls = 0;
    const execution = await executeBrainTools({
      parsed: parseGeminiResponse(
        '###TOOL###{"create_appointment":{"service_name":"Home cleaning","name":"Amina","when_text":"Tuesday 10 AM","location":"Kericho"}}###ENDTOOL###'
      ),
      capabilities,
      hoursSchedule: defaultHoursSchedule(),
      now,
      businessPolicies: { delivery: 'Westlands and Kilimani' },
      handlers: {
        createAppointment: async () => {
          calls += 1;
          return { id: 'nope' };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(execution.results[0].status, 'invalid');
    assert.equal(execution.results[0].code, 'outside_coverage');
    assert.match(formatToolConfirmation(execution.results, 'en'), /outside our coverage/i);
    assert.match(formatToolConfirmation(execution.results, 'sw'), /nje/i);
    assert.match(formatToolConfirmation(execution.results, 'sheng'), /nje/i);
    assert.doesNotMatch(formatToolConfirmation(execution.results, 'en'), /landmark/i);
  });

  it('flags confirm access when an in-coverage area is saved', async () => {
    let saved = null;
    const execution = await executeBrainTools({
      parsed: parseGeminiResponse(
        '###TOOL###{"create_appointment":{"service_name":"Home cleaning","name":"Amina","when_text":"Tuesday 10 AM","landmark":"Runda"}}###ENDTOOL###'
      ),
      capabilities,
      hoursSchedule: defaultHoursSchedule(),
      now,
      businessPolicies: { delivery: 'Runda and Karen' },
      handlers: {
        createAppointment: async (appointment) => {
          saved = appointment;
          return { id: 'appt_area', status: 'requested' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved.landmark, 'Runda');
    assert.match(saved.notes, /confirm access/i);
  });

  it('keeps retail directions on shop landmarks', () => {
    const retail = formatPlaybookForPrompt({ vertical: 'retail' });
    assert.match(retail, /LOCATIONS landmark\/directions/);
    assert.doesNotMatch(retail, /Where should we come/);
    const home = formatPlaybookForPrompt({ vertical: 'home_services' });
    assert.match(home, /Where should we come/);
    assert.doesNotMatch(home, /LOCATIONS landmark\/directions/);
  });
});
